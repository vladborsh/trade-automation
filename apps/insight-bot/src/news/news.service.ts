import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { DB, type Db } from '../db/db.port';
import { knownNews, persistPlan, recentForClustering } from '../db/pg/news-store';
import { CLUSTER_WINDOW_MS } from './cluster';
import { planIngest } from './ingest-plan';
import { NewsClient } from './news.client';
import { JSON_PARSERS } from './parse-json';
import { parseFeed, type NewsItem } from './parse';
import { afterAttempt, dueSources, type SourceState } from './schedule';
import { NEWS_SOURCES, type NewsSource } from './sources';

/** One tick a minute: the per-source cadences are 5 and 15 minutes, so this is fine-grained enough. */
export const TICK_MS = 60_000;

/**
 * How far back a pass looks for duplicates and for clustering.
 *
 * Three days for the dedupe set, because the feeds are a rolling window of roughly three to four
 * days (measured 2026-09-28) and a source cannot re-serve anything older. The clustering window is
 * the design's 24 hours and is applied by `chooseCluster` itself; the query simply must not return
 * less than that.
 */
export const DEDUPE_WINDOW_MS = 3 * 24 * 60 * 60_000;

/**
 * IB-027 — the news poll (§10).
 *
 * The shell only: every rule lives in a pure module beside it — which source is due
 * (`schedule.ts`), what the bytes mean (`parse.ts`, `parse-json.ts`), what should be written
 * (`ingest-plan.ts`) and how (`db/pg/news-store.ts`). That is why there is almost nothing to test
 * here directly, and why the specs that matter are elsewhere.
 *
 * **One source's failure is contained.** A feed that is down, has moved or has changed shape must
 * not stop the other nine: each is fetched, parsed and persisted independently, and a failure only
 * backs that source off. The alternative — one pass that either succeeds or does not — would let
 * the least reliable source set the tape's coverage.
 *
 * Request rate: ten sources, seven at a 5-minute cadence and three at 15, so ≈ 96 requests/hour
 * spread over ten different hosts — about 1.6/min in total and well under one per minute per host.
 * No venue rate limit is involved; these are public feeds.
 */
@Injectable()
export class NewsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('NewsIngest');
  private readonly client: NewsClient;
  private readonly sources: readonly NewsSource[];
  private readonly state = new Map<string, SourceState>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Db | null,
    @Optional() client?: NewsClient,
    @Optional() sources?: readonly NewsSource[],
  ) {
    this.client = client ?? new NewsClient();
    this.sources = sources ?? NEWS_SOURCES;
  }

  onApplicationBootstrap(): void {
    if (!this.db) {
      this.logger.warn('no database — news ingest disabled');
      return;
    }
    void this.tick();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
    this.logger.log(`news ingest started for ${this.sources.length} sources`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One sweep: every source whose cadence is up. Public so a spec can drive it without timers. */
  async tick(now = Date.now()): Promise<void> {
    // A slow pass must not overlap the next tick: two passes over one source would both plan
    // against the same `known` set and race on the unique index, turning a tidy skip into a
    // conflict. Dropping the tick is free — the next one is a minute away and the feed still
    // holds everything.
    if (this.running) return;
    this.running = true;
    try {
      for (const source of dueSources(now, this.sources, this.state)) {
        // `now` is threaded through rather than each step reading the clock: the scheduler and the
        // state it writes must agree, or a pass stamps attempts with a different time than the one
        // that decided they were due. A spec driving tick(now) would then never see a second poll.
        await this.pollOne(source, now);
      }
    } finally {
      this.running = false;
    }
  }

  private async pollOne(source: NewsSource, now: number): Promise<void> {
    const db = this.db;
    if (!db) return;

    const outcome = await this.client.fetchSource(source);
    if (!outcome.ok) {
      this.state.set(source.id, afterAttempt(this.state.get(source.id), now, false));
      const failures = this.state.get(source.id)?.consecutiveFailures ?? 1;
      this.logger.warn(`${source.id}: ${outcome.reason} (consecutive failures: ${failures})`);
      return;
    }

    let items: NewsItem[];
    try {
      // A time-filtered source legitimately answers with nothing on a quiet day; the client has
      // already refused an empty body from a window feed, so reaching here with one means the
      // source is allowed to be quiet. Parsing '' would throw and be counted a failure.
      items = outcome.body.trim().length === 0 ? [] : this.parse(source, outcome.body);
    } catch (error) {
      // a feed that changed shape is a failure of this source, not of the pass
      this.state.set(source.id, afterAttempt(this.state.get(source.id), now, false));
      this.logger.warn(`${source.id}: unparseable — ${(error as Error).message}`);
      return;
    }

    try {
      const since = new Date(now - DEDUPE_WINDOW_MS);
      const plan = planIngest({
        items,
        known: await knownNews(db, [source.id], since),
        // the clustering window is 24 h and applied by chooseCluster; this must not return less
        recent: await recentForClustering(db, new Date(now - Math.max(CLUSTER_WINDOW_MS, DEDUPE_WINDOW_MS))),
      });
      const result = await persistPlan(db, plan, this.sources.length);
      this.state.set(source.id, afterAttempt(this.state.get(source.id), now, true));

      if (result.inserted > 0) {
        this.logger.log(
          `${source.id}: +${result.inserted} (${result.clustersCreated} new clusters, ${result.clustersJoined} joined)`,
        );
      }
    } catch (error) {
      // the write failed: count it as a failure so the source backs off rather than retrying a
      // broken database every minute
      this.state.set(source.id, afterAttempt(this.state.get(source.id), now, false));
      this.logger.error(`${source.id}: persist failed — ${(error as Error).message}`);
    }
  }

  private parse(source: NewsSource, body: string): NewsItem[] {
    if (source.kind === 'json') {
      const parser = JSON_PARSERS[source.id];
      if (parser === undefined) throw new Error(`no JSON parser registered for ${source.id}`);
      const result = parser(source.id, body);
      this.reportSkipped(source, result.skipped);
      return result.items;
    }
    const result = parseFeed(source.id, body);
    this.reportSkipped(source, result.skipped);
    return result.items;
  }

  /**
   * Entries the parser refused. Logged rather than swallowed: a feed that starts omitting dates
   * would otherwise shrink silently, and "this source published less today" is indistinguishable
   * from "this source changed shape" unless someone says so.
   */
  private reportSkipped(source: NewsSource, skipped: ReadonlyArray<{ reason: string; sample: string }>): void {
    if (skipped.length === 0) return;
    const reasons = [...new Set(skipped.map((s) => s.reason))].join(', ');
    this.logger.warn(`${source.id}: ${skipped.length} entries skipped (${reasons})`);
  }
}

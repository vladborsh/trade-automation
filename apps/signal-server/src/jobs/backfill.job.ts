import { Candle, Instrument, InstrumentId, Venue } from '@trade-automation/contracts';
import { CapComPriceNotFoundError } from '../market-data/capitalcom/capitalcom.adapter';
import { VenueAdapter } from '../market-data/venue-adapter.port';
import { CandleStore } from '../storage/candle-store.port';
import { DeriveCounts, deriveTimeframes } from './derive-timeframes.job';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/**
 * architecture/backtest-app-system-design.md §10 — how the backfill pages one venue's 1m history.
 * Every `fetchCandles` call asks for exactly one venue page, so the adapter makes exactly one
 * data request per call, and the job throttles the calls.
 *
 * - **Binance** `fapi/v1/klines?limit=1500` is weight 10 per request. At 1 request/s that is
 *   **600 weight/min = 25 % of the 2400/min budget** (AGENTS.md: a venue-polling design states its
 *   weight per minute). The live path uses ~1 %. There is no fixed floor: the first page that
 *   comes back empty is before the listing. A 25 h window with no bars has never happened on the
 *   perps.
 * - **Capital.com** `/prices?max=720`: 720-bar pages at 1 request/s. The session login (1 request,
 *   renewed every 9 min) comes on top. **Hard stop at the 2024-01-02 intraday floor**, and a 404
 *   (`CapComPriceNotFoundError`) also means the vendor floor. Empty pages are normal (weekends,
 *   closed sessions) and do not stop the walk.
 */
export interface VenuePaging {
  pageBars: number;
  minIntervalMs: number;
  floorMs?: number;
  emptyPageIsFloor: boolean;
}

export const VENUE_PAGING: Readonly<Partial<Record<Venue, VenuePaging>>> = {
  binance: { pageBars: 1500, minIntervalMs: 1000, emptyPageIsFloor: true },
  capitalcom: { pageBars: 720, minIntervalMs: 1000, floorMs: Date.UTC(2024, 0, 2), emptyPageIsFloor: false },
};

/** The job's clock, injected so the throttle is testable with a fake one. */
export interface BackfillClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const SYSTEM_CLOCK: BackfillClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Waits between retries of a failed page; every retry is throttled like any request. */
export const RETRY_BACKOFF_MS: readonly number[] = [5_000, 30_000, 60_000];

export interface BackfillOptions {
  /** Forward mode: refetch from this time to the last closed minute (see `backfill1m`). */
  fromMs?: number;
}

export interface BackfillCounts {
  instrument: InstrumentId;
  direction: 'backward' | 'forward';
  requests: number;
  retries: number;
  candles: number;
  /** UTC days upserted (one `upsert` each). */
  days: number;
  /** Earliest and latest openTime written; undefined when nothing was written. */
  fromMs?: number;
  toMs?: number;
  /** Why the walk stopped. */
  stop: 'floor' | 'empty-page' | 'not-found' | 'now' | 'nothing-to-do';
}

export interface BackfillDeps {
  clock: BackfillClock;
  /** One line per upserted day (progress; lets an interrupted forward run be resumed). */
  log?: (line: Record<string, unknown>) => void;
}

/**
 * architecture/backtest-app-system-design.md §10 — backfill one instrument's 1m from its venue.
 *
 * - **Backward (default), resumable.** The walk starts just below the earliest stored 1m bar, or
 *   at the last closed minute when nothing is stored. It goes down page by page to the vendor
 *   floor. A UTC day is upserted as soon as it is fully fetched, so an interrupted run leaves only
 *   complete days. The next run starts below them: the earliest stored bar is the checkpoint, and
 *   nothing is fetched twice. Everything above the earliest stored bar belongs to the live ingest
 *   or an earlier run; gaps inside it are the gap-repair service's job, or use the forward mode.
 * - **Forward (`fromMs`).** Refetches from `fromMs` (clamped to the vendor floor) up to the last
 *   closed minute, upserting each day once it is complete. It fills gaps inside existing coverage,
 *   for example after an outage. Idempotent. An interrupted run is resumed by rerunning from the
 *   last logged day.
 * - One request per page, at most one request per `minIntervalMs` measured start to start. A
 *   failed page is retried after `RETRY_BACKOFF_MS`, then the job fails; rerunning resumes.
 *
 * Returns what it did. The caller runs derive-timeframes afterwards.
 */
export async function backfill1m(
  store: CandleStore,
  adapter: VenueAdapter,
  instrument: Instrument,
  options: BackfillOptions,
  deps: BackfillDeps,
): Promise<BackfillCounts> {
  const paging = VENUE_PAGING[instrument.venue];
  if (!paging) throw new Error(`no backfill paging for venue ${instrument.venue}`);
  const direction = options.fromMs === undefined ? 'backward' : 'forward';
  const counts: BackfillCounts = { instrument: instrument.id, direction, requests: 0, retries: 0, candles: 0, days: 0, stop: 'nothing-to-do' };
  const lastClosed = Math.floor(deps.clock.now() / MIN) * MIN - MIN;
  const floor = paging.floorMs ?? Number.NEGATIVE_INFINITY;
  const span = (paging.pageBars - 1) * MIN; // a page covers pageBars minutes, both ends inclusive

  const pending = new Map<number, Candle[]>(); // UTC day → fetched bars not yet written
  const flush = async (complete: (day: number) => boolean) => {
    const days = [...pending.keys()].filter(complete).sort((a, b) => (direction === 'backward' ? b - a : a - b));
    for (const day of days) {
      const bars = pending.get(day)!;
      pending.delete(day);
      if (bars.length === 0) continue;
      bars.sort((a, b) => a.openTime - b.openTime);
      await store.upsert(bars);
      counts.days++;
      counts.candles += bars.length;
      counts.fromMs = Math.min(counts.fromMs ?? bars[0].openTime, bars[0].openTime);
      counts.toMs = Math.max(counts.toMs ?? 0, bars[bars.length - 1].openTime);
      deps.log?.({ instrument: instrument.id, day: new Date(day).toISOString().slice(0, 10), candles: bars.length });
    }
  };

  let lastRequestAt = Number.NEGATIVE_INFINITY;
  /** One page: the closed bars inside [start, end], or null when the venue says "no data this far back". */
  const fetchPage = async (start: number, end: number): Promise<Candle[] | null> => {
    for (let attempt = 0; ; attempt++) {
      const wait = lastRequestAt + paging.minIntervalMs - deps.clock.now();
      if (wait > 0) await deps.clock.sleep(wait);
      lastRequestAt = deps.clock.now();
      counts.requests++;
      try {
        const rows = await adapter.fetchCandles(instrument, '1m', start, end);
        return rows.filter((c) => c.closed && c.openTime >= start && c.openTime <= end);
      } catch (err) {
        if (err instanceof CapComPriceNotFoundError) return null;
        if (attempt >= RETRY_BACKOFF_MS.length) throw err;
        counts.retries++;
        await deps.clock.sleep(RETRY_BACKOFF_MS[attempt]);
      }
    }
  };
  const add = (bars: readonly Candle[]) => {
    for (const bar of bars) {
      const day = Math.floor(bar.openTime / DAY) * DAY;
      const list = pending.get(day) ?? [];
      list.push(bar);
      pending.set(day, list);
    }
  };

  if (direction === 'backward') {
    const coverage = await store.coverage(instrument.id, '1m');
    let end = coverage ? coverage.from - MIN : lastClosed;
    if (end < floor) return counts;
    for (;;) {
      if (end < floor) {
        counts.stop = 'floor';
        break;
      }
      const start = Math.max(end - span, floor);
      const bars = await fetchPage(start, end);
      if (bars === null) {
        counts.stop = 'not-found';
        break;
      }
      if (bars.length === 0 && paging.emptyPageIsFloor) {
        counts.stop = 'empty-page';
        break;
      }
      add(bars);
      await flush((day) => day >= start); // days fetched down to their start
      end = start - MIN;
    }
  } else {
    let start = Math.max(Math.floor(options.fromMs! / MIN) * MIN, floor);
    for (;;) {
      if (start > lastClosed) {
        counts.stop = 'now';
        break;
      }
      const end = Math.min(start + span, lastClosed);
      add((await fetchPage(start, end)) ?? []); // a 404 here: before the retention floor, keep going
      await flush((day) => day + DAY - MIN <= end); // days fetched up to their last minute
      start = end + MIN;
    }
  }
  await flush(() => true);
  return counts;
}

/**
 * The whole job for one instrument: `backfill1m`, then derive-timeframes from the earliest day it
 * wrote (T-012's `deriveTimeframes`, which only fills bars that are absent). Nothing written means
 * nothing to derive.
 */
export async function backfillAndDerive(
  store: CandleStore,
  adapter: VenueAdapter,
  instrument: Instrument,
  options: BackfillOptions,
  deps: BackfillDeps,
): Promise<{ backfill: BackfillCounts; derived: DeriveCounts | null }> {
  const backfill = await backfill1m(store, adapter, instrument, options, deps);
  const derived = backfill.fromMs === undefined ? null : await deriveTimeframes(store, instrument.id, { fromMs: backfill.fromMs, force: false });
  return { backfill, derived };
}

export interface BackfillArgs {
  instrument: InstrumentId;
  fromMs?: number;
}

/** `--instrument <id> [--from <iso>]`. */
export function parseBackfillArgs(argv: readonly string[]): BackfillArgs {
  let instrument: InstrumentId | undefined;
  let fromMs: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag !== '--instrument' && flag !== '--from') throw new Error(`unknown argument: ${flag}`);
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    if (flag === '--instrument') {
      instrument = value as InstrumentId;
    } else {
      fromMs = Date.parse(value);
      if (Number.isNaN(fromMs)) throw new Error(`--from: not an ISO date: ${value}`);
    }
  }
  if (!instrument) throw new Error('--instrument <id> is required');
  return fromMs === undefined ? { instrument } : { instrument, fromMs };
}

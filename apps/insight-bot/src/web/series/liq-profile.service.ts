import { Inject, Injectable, Optional } from '@nestjs/common';
import { foldProfile, profileGrid, type WebLiqProfileResponse } from '@trade-automation/contracts';
import { LIQUIDATION_STREAMS } from '../../collectors/uptime/liquidation-streams';
import { DB, type Db } from '../../db/db.port';
import { gapsOverlapping, heartbeats } from '../../db/pg/uptime-reads';
import { IDLE_SWEEP_MS, TtlCache } from '../../venues/ttl-cache';
import { profileVenueStates } from './liq-profile-venues';
import { liqProfileGroups, venueSymbols } from './pg/liq-profile.repo';

/** A window ending this close to now is live: its answer is kept 15 s (the overview's cadence). */
export const LIQ_PROFILE_LIVE_EDGE_MS = 5 * 60_000;
export const LIQ_PROFILE_LIVE_TTL_MS = 15_000;
/** A window in the past does not change (barring a backfill): kept 10 minutes. */
export const LIQ_PROFILE_PAST_TTL_MS = 10 * 60_000;
export const LIQ_PROFILE_CACHE_KEYS = 200;

const STREAM_OF: Record<string, string> = Object.fromEntries(LIQUIDATION_STREAMS.map((s) => [s.venue, s.stream]));

/**
 * IB-153 — `GET /api/web/series/liquidations/profile`: the coin's liquidations in [from, to) by price band.
 * Our tape only: venue weight 0.
 *
 * One grouped read (`liq-profile.repo.ts`) plus the uptime rows for the venue states. Cached per
 * (symbol, from, to, step, cover): the client snaps from/to to its bar grid and the cover to whole
 * chunks, so a pan of less than a bar or a scroll inside the cover is the same key.
 */
@Injectable()
export class LiqProfileService {
  private readonly cache: TtlCache;

  constructor(
    @Inject(DB) private readonly db: Db | null,
    @Optional() private readonly now: () => number = () => Date.now(),
  ) {
    this.cache = new TtlCache({ now: () => this.now(), maxEntries: LIQ_PROFILE_CACHE_KEYS, name: 'liquidation-profile', idleSweepMs: IDLE_SWEEP_MS });
  }

  profile(symbol: string, fromMs: number, toMs: number, lo: number, hi: number): Promise<WebLiqProfileResponse> {
    const grid = profileGrid(lo, hi);
    const key = `${symbol}:${fromMs}:${toMs}:${grid.step}:${grid.coverLo}:${grid.coverHi}`;
    const ttl = toMs >= this.now() - LIQ_PROFILE_LIVE_EDGE_MS ? LIQ_PROFILE_LIVE_TTL_MS : LIQ_PROFILE_PAST_TTL_MS;
    return this.cache.getOrLoad(key, ttl, async () => {
      const db = this.db;
      if (!db) throw new Error('no database');
      const nowMs = this.now();
      const listed = (await venueSymbols(db, symbol)) ?? { binance: null, bybit: null, okx: null };
      const pairs = Object.entries(listed).flatMap(([venue, s]) => (s === null ? [] : [{ venue, symbol: s }]));
      const [groups, beats, gaps] = await Promise.all([
        liqProfileGroups(db, { pairs, fromMs, toMs, stepText: String(grid.step), coverLo: grid.coverLo, coverHi: grid.coverHi }),
        heartbeats(db),
        gapsOverlapping(db, new Date(fromMs), new Date(toMs), LIQUIDATION_STREAMS.map((s) => s.stream)),
      ]);
      const rowsByVenue = new Map<string, number>();
      for (const g of groups) rowsByVenue.set(g.venue, (rowsByVenue.get(g.venue) ?? 0) + g.count);
      return {
        symbol,
        from: fromMs,
        to: toMs,
        ...grid,
        ...foldProfile(groups, grid),
        venues: profileVenueStates({ listed, streamOf: STREAM_OF, beats, gaps, rowsByVenue, fromMs, toMs, nowMs }),
        undercounted: listed.binance !== null,
      };
    });
  }
}

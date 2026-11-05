import type { OiDivergenceDirection, OiDivergenceKind, OiDivergenceTf } from '@trade-automation/contracts';
import type { DbHandle } from '../../../db/db.port';

/**
 * IB-116 (design V31) — the two facts that bound the history run, read from the database:
 * - where each coin's stored OI starts (the run's start, as the chart's span starts there, V11);
 * - where the LIVE research journal starts (the run's end): the first `source = 'live'` control row, as the
 *   design says. IB-115's first evaluation on the box wrote controls (3 random 4h controls at 21:41:43 UTC on
 *   2026-11-04), so that row's moment is the live loop's first evaluation.
 */
export class PgBackfillReads {
  constructor(private readonly db: DbHandle) {}

  /** Unix seconds of the first stored 5 m OI reading of `symbol`, or null when we store none. */
  async firstStoredOi(symbol: string): Promise<number | null> {
    const [row] = await this.db.query<{ first: Date | null }>(
      `select min(ts) as first from open_interest_5m where venue = 'binance' and symbol = $1`, [symbol]);
    return row?.first ? Math.floor(new Date(row.first).getTime() / 1000) : null;
  }

  /** Unix seconds of the first live control row, or null when the live research journal has not started. */
  async liveStart(): Promise<number | null> {
    const [row] = await this.db.query<{ first: Date | null }>(
      `select min(created_at) as first from oi_divergence_controls where source = 'live'`, []);
    return row?.first ? Math.floor(new Date(row.first).getTime() / 1000) : null;
  }

  /**
   * IB-144 (V47): the end of the hidden backfill for (symbol, tf) — the first LIVE control row of the pair written by
   * the hidden-aware build, i.e. whose params carry `sendHidden` (migration 033 adds it; an older image strips it on
   * read, so its rows never have it). Null when the pair has none yet. Random controls are 2 per pair per day.
   */
  async hiddenEnd(symbol: string, tf: OiDivergenceTf): Promise<number | null> {
    const [row] = await this.db.query<{ first: Date | null }>(
      `select min(created_at) as first from oi_divergence_controls
        where source = 'live' and symbol = $1 and tf = $2 and (params -> 'perTf' -> $2) ? 'sendHidden'`, [symbol, tf]);
    return row?.first ? Math.floor(new Date(row.first).getTime() / 1000) : null;
  }

  /** IB-144 (V47): whether the LIVE loop already journalled this B of this kind (an alert, or a near-miss). */
  async hasLive(what: 'alert' | 'near_miss', symbol: string, tf: OiDivergenceTf, kind: OiDivergenceKind, direction: OiDivergenceDirection, bTime: number): Promise<boolean> {
    const table = what === 'alert' ? 'oi_divergence_alerts' : 'oi_divergence_near_misses';
    const rows = await this.db.query(
      `select 1 from ${table} where source = 'live' and symbol = $1 and tf = $2 and kind = $3 and direction = $4 and b_time = $5 limit 1`,
      [symbol, tf, kind, direction, new Date(bTime * 1000)]);
    return rows.length > 0;
  }

  /** IB-144: backfill alert rows per (tf, kind) — what V47's «regular unchanged» compares the dry run's count with. */
  async backfillAlertKeys(): Promise<Array<{ tf: OiDivergenceTf; kind: OiDivergenceKind; symbol: string; direction: OiDivergenceDirection; aTime: number; bTime: number }>> {
    const rows = await this.db.query<{ tf: OiDivergenceTf; kind: OiDivergenceKind; symbol: string; direction: OiDivergenceDirection; a_time: Date; b_time: Date }>(
      `select tf, kind, symbol, direction, a_time, b_time from oi_divergence_alerts where source = 'backfill' order by tf, kind, symbol, b_time`, []);
    const s = (d: Date) => Math.floor(new Date(d).getTime() / 1000);
    return rows.map((r) => ({ tf: r.tf, kind: r.kind, symbol: r.symbol, direction: r.direction, aTime: s(r.a_time), bTime: s(r.b_time) }));
  }

  /** Backfill path windows not measured yet, and when the last of them closes (unix seconds). */
  async unmeasuredBackfillPaths(): Promise<{ count: number; lastCloses: number | null }> {
    const [row] = await this.db.query<{ n: string | number; last: Date | null }>(
      `select count(*) as n,
              max(p.t0 + case p.win when '4h' then interval '4 hours' when '24h' then interval '24 hours' else interval '72 hours' end) as last
         from oi_divergence_paths p
         left join oi_divergence_alerts a on a.id = p.alert_id
         left join oi_divergence_controls c on c.id = p.control_id
         left join oi_divergence_near_misses n on n.id = p.near_miss_id
        where p.measured_at is null and coalesce(a.source, c.source, n.source) = 'backfill'`, []);
    return { count: Number(row?.n ?? 0), lastCloses: row?.last ? Math.floor(new Date(row.last).getTime() / 1000) : null };
  }

  /** Rows per table with `source = 'backfill'` — what a run (or a dry run inside its transaction) has written. */
  async backfillCounts(): Promise<Record<string, number>> {
    const rows = await this.db.query<{ t: string; n: string | number }>(
      `select 'alerts' as t, count(*) as n from oi_divergence_alerts where source = 'backfill'
       union all select 'alerts_hidden', count(*) from oi_divergence_alerts where source = 'backfill' and kind = 'hidden'
       union all select 'near_misses_hidden', count(*) from oi_divergence_near_misses where source = 'backfill' and kind = 'hidden'
       union all select 'controls_pivot', count(*) from oi_divergence_controls where source = 'backfill' and kind = 'pivot'
       union all select 'controls_random', count(*) from oi_divergence_controls where source = 'backfill' and kind = 'random'
       union all select 'near_misses', count(*) from oi_divergence_near_misses where source = 'backfill'
       union all select 'paths', count(*) from oi_divergence_paths p
         left join oi_divergence_alerts a on a.id = p.alert_id
         left join oi_divergence_controls c on c.id = p.control_id
         left join oi_divergence_near_misses n on n.id = p.near_miss_id
        where coalesce(a.source, c.source, n.source) = 'backfill'`, []);
    return Object.fromEntries(rows.map((r) => [r.t, Number(r.n)]));
  }
}

import type { DbHandle } from '../../../db/db.port';

const ms = (d: Date | string | null): number | null => (d === null ? null : new Date(d).getTime());

/** A `market_alerts` type with a history run: liquidations (IB-123) and funding (IB-125). */
export type MarketBackfillType = 'liq' | 'funding';

/**
 * IB-123, generalised by IB-125 — the reads a market-alert history run is bounded and checked by, for ONE type.
 * Every count is that type and `source = 'backfill'` only: live rows are never pooled with it (V32), and one
 * type's run never counts or measures another's rows.
 */
export class PgMarketBackfillReads {
  constructor(protected readonly db: DbHandle, readonly type: MarketBackfillType) {}

  /**
   * Live rows of the type (alerts and controls) with `at` at or before `untilMs`. The run's end must be the
   * live loop's first evaluated moment; a live row before it means the end is wrong (the two would overlap).
   */
  async liveRowsUpTo(untilMs: number): Promise<number> {
    const [r] = await this.db.query<{ n: string }>(
      `select (select count(*) from market_alerts where type = $2 and source = 'live' and at <= $1)
            + (select count(*) from market_alert_controls where type = $2 and source = 'live' and at <= $1) as n`,
      [new Date(untilMs), this.type]);
    return Number(r?.n ?? 0);
  }

  /** Backfill path windows of the type not measured yet, and when the last of them closes (epoch ms). */
  async unmeasuredPaths(): Promise<{ count: number; lastCloses: number | null }> {
    const [r] = await this.db.query<{ n: string; last: Date | null }>(
      `select count(*) as n,
              max(p.t0 + case p.win when '4h' then interval '4 hours' when '24h' then interval '24 hours' else interval '72 hours' end) as last
         from oi_divergence_paths p
         left join market_alerts ma on ma.id = p.market_alert_id and ma.type = $1
         left join market_alert_controls mc on mc.id = p.market_control_id and mc.type = $1
        where p.measured_at is null and coalesce(ma.source, mc.source) = 'backfill'`, [this.type]);
    return { count: Number(r?.n ?? 0), lastCloses: ms(r?.last ?? null) };
  }

  /** Backfill path windows of the type closed (+ 60 s) and unmeasured at `nowMs`, and their klines weight (V24: 1 / 2 / 5). */
  async pathsDueNow(nowMs: number): Promise<{ windows: number; weight: number }> {
    const [r] = await this.db.query<{ n: string; w: string | null }>(
      `select count(*) as n, sum(case p.win when '4h' then 1 when '24h' then 2 else 5 end) as w
         from oi_divergence_paths p
         left join market_alerts ma on ma.id = p.market_alert_id and ma.type = $2
         left join market_alert_controls mc on mc.id = p.market_control_id and mc.type = $2
        where p.measured_at is null and coalesce(ma.source, mc.source) = 'backfill'
          and p.t0 + case p.win when '4h' then interval '4 hours' when '24h' then interval '24 hours' else interval '72 hours' end
              + interval '60 seconds' <= $1`, [new Date(nowMs), this.type]);
    return { windows: Number(r?.n ?? 0), weight: Number(r?.w ?? 0) };
  }

  /** Backfill rows of the type: `alerts_<event>` per event, `controls_<kind>` per kind, `paths`, `paths_measured`. */
  protected async rowsByEventAndKind(): Promise<Record<string, number>> {
    const rows = await this.db.query<{ t: string; n: string }>(
      `select 'alerts_' || event as t, count(*) as n from market_alerts where type = $1 and source = 'backfill' group by event
       union all select 'controls_' || kind, count(*) from market_alert_controls where type = $1 and source = 'backfill' group by kind
       union all select 'paths', count(*) from oi_divergence_paths p
         left join market_alerts ma on ma.id = p.market_alert_id and ma.type = $1
         left join market_alert_controls mc on mc.id = p.market_control_id and mc.type = $1
        where coalesce(ma.source, mc.source) = 'backfill'
       union all select 'paths_measured', count(p.measured_at) from oi_divergence_paths p
         left join market_alerts ma on ma.id = p.market_alert_id and ma.type = $1
         left join market_alert_controls mc on mc.id = p.market_control_id and mc.type = $1
        where coalesce(ma.source, mc.source) = 'backfill'`, [this.type]);
    return Object.fromEntries(rows.map((r) => [r.t, Number(r.n)]));
  }
}

/** IB-125: the funding history run's reads. `backfillCounts` keys: `alerts_enter`, `alerts_flip`, `controls_random`, `controls_near_miss`, `paths`, `paths_measured`. */
export class PgFundingBackfillReads extends PgMarketBackfillReads {
  constructor(db: DbHandle) {
    super(db, 'funding');
  }

  backfillCounts(): Promise<Record<string, number>> {
    return this.rowsByEventAndKind();
  }
}

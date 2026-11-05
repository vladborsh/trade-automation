import type { DbHandle } from '../../../db/db.port';
import { BINANCE_LIQUIDATION_STREAM } from '../../../collectors/uptime/liquidation-streams';
import { STREAM_LIQUIDATION as BYBIT_STREAM } from '../../../collectors/bybit/bybit-collector';
import { STREAM_LIQUIDATION as OKX_STREAM } from '../../../collectors/okx/okx-collector';

/** The three liquidation streams' heartbeat names, Binance first. */
export const LIQ_STREAMS = [BINANCE_LIQUIDATION_STREAM, BYBIT_STREAM, OKX_STREAM] as const;

const ms = (d: Date | string | null): number | null => (d === null ? null : new Date(d).getTime());

/**
 * IB-123 (design L9) — what bounds and checks the liquidation history run, read from the database.
 * Every count is `type = 'liq'` and `source = 'backfill'` only: live rows are never pooled with it (V32).
 */
export class PgLiqBackfillReads {
  constructor(private readonly db: DbHandle) {}

  /** Per stream (in `LIQ_STREAMS` order), its first heartbeat, epoch ms; null = never seen. */
  async streamStarts(): Promise<Array<number | null>> {
    const rows = await this.db.query<{ stream: string; first_seen_at: Date }>(
      'select stream, first_seen_at from collector_heartbeats where stream = any($1::text[])', [[...LIQ_STREAMS]]);
    return LIQ_STREAMS.map((s) => ms(rows.find((r) => r.stream === s)?.first_seen_at ?? null));
  }

  /**
   * Live liquidation rows (alerts and controls) with `at` at or before `untilMs`. The run's end must be the
   * live loop's first evaluated moment; a live row before it means the end is wrong (the two would overlap).
   */
  async liveRowsUpTo(untilMs: number): Promise<number> {
    const [r] = await this.db.query<{ n: string }>(
      `select (select count(*) from market_alerts where type = 'liq' and source = 'live' and at <= $1)
            + (select count(*) from market_alert_controls where type = 'liq' and source = 'live' and at <= $1) as n`,
      [new Date(untilMs)]);
    return Number(r?.n ?? 0);
  }

  /** Backfill rows by table / event / kind, and their paths. */
  async backfillCounts(): Promise<Record<string, number>> {
    const rows = await this.db.query<{ t: string; n: string }>(
      `select 'alerts' as t, count(*) as n from market_alerts where type = 'liq' and source = 'backfill' and event = 'alert'
       union all select 'continuations', count(*) from market_alerts where type = 'liq' and source = 'backfill' and event = 'continuing'
       union all select 'controls_random', count(*) from market_alert_controls where type = 'liq' and source = 'backfill' and kind = 'random'
       union all select 'controls_near_miss', count(*) from market_alert_controls where type = 'liq' and source = 'backfill' and kind = 'near_miss'
       union all select 'paths', count(*) from oi_divergence_paths p
         left join market_alerts ma on ma.id = p.market_alert_id and ma.type = 'liq'
         left join market_alert_controls mc on mc.id = p.market_control_id and mc.type = 'liq'
        where coalesce(ma.source, mc.source) = 'backfill'
       union all select 'paths_measured', count(p.measured_at) from oi_divergence_paths p
         left join market_alerts ma on ma.id = p.market_alert_id and ma.type = 'liq'
         left join market_alert_controls mc on mc.id = p.market_control_id and mc.type = 'liq'
        where coalesce(ma.source, mc.source) = 'backfill'`, []);
    return Object.fromEntries(rows.map((r) => [r.t, Number(r.n)]));
  }

  /** Backfill liquidation path windows not measured yet, and when the last of them closes (epoch ms). */
  async unmeasuredPaths(): Promise<{ count: number; lastCloses: number | null }> {
    const [r] = await this.db.query<{ n: string; last: Date | null }>(
      `select count(*) as n,
              max(p.t0 + case p.win when '4h' then interval '4 hours' when '24h' then interval '24 hours' else interval '72 hours' end) as last
         from oi_divergence_paths p
         left join market_alerts ma on ma.id = p.market_alert_id and ma.type = 'liq'
         left join market_alert_controls mc on mc.id = p.market_control_id and mc.type = 'liq'
        where p.measured_at is null and coalesce(ma.source, mc.source) = 'backfill'`, []);
    return { count: Number(r?.n ?? 0), lastCloses: ms(r?.last ?? null) };
  }

  /** Backfill liquidation path windows closed (+ 60 s) and unmeasured at `nowMs`, and their klines weight (V24: 1 / 2 / 5). */
  async pathsDueNow(nowMs: number): Promise<{ windows: number; weight: number }> {
    const [r] = await this.db.query<{ n: string; w: string | null }>(
      `select count(*) as n, sum(case p.win when '4h' then 1 when '24h' then 2 else 5 end) as w
         from oi_divergence_paths p
         left join market_alerts ma on ma.id = p.market_alert_id and ma.type = 'liq'
         left join market_alert_controls mc on mc.id = p.market_control_id and mc.type = 'liq'
        where p.measured_at is null and coalesce(ma.source, mc.source) = 'backfill'
          and p.t0 + case p.win when '4h' then interval '4 hours' when '24h' then interval '24 hours' else interval '72 hours' end
              + interval '60 seconds' <= $1`, [new Date(nowMs)]);
    return { windows: Number(r?.n ?? 0), weight: Number(r?.w ?? 0) };
  }
}

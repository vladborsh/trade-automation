import type { DbHandle } from '../../../db/db.port';
import { BINANCE_LIQUIDATION_STREAM } from '../../../collectors/uptime/liquidation-streams';
import { STREAM_LIQUIDATION as BYBIT_STREAM } from '../../../collectors/bybit/bybit-collector';
import { STREAM_LIQUIDATION as OKX_STREAM } from '../../../collectors/okx/okx-collector';
import { PgMarketBackfillReads } from './market-backfill-reads';

/** The three liquidation streams' heartbeat names, Binance first. */
export const LIQ_STREAMS = [BINANCE_LIQUIDATION_STREAM, BYBIT_STREAM, OKX_STREAM] as const;

const ms = (d: Date | string | null): number | null => (d === null ? null : new Date(d).getTime());

/**
 * IB-123 (design L9) — what bounds and checks the liquidation history run, read from the database.
 * Every count is `type = 'liq'` and `source = 'backfill'` only: live rows are never pooled with it (V32).
 * The type-generic reads (live rows up to the end, paths due and left) are `PgMarketBackfillReads` (IB-125).
 */
export class PgLiqBackfillReads extends PgMarketBackfillReads {
  constructor(db: DbHandle) {
    super(db, 'liq');
  }

  /** Per stream (in `LIQ_STREAMS` order), its first heartbeat, epoch ms; null = never seen. */
  async streamStarts(): Promise<Array<number | null>> {
    const rows = await this.db.query<{ stream: string; first_seen_at: Date }>(
      'select stream, first_seen_at from collector_heartbeats where stream = any($1::text[])', [[...LIQ_STREAMS]]);
    return LIQ_STREAMS.map((s) => ms(rows.find((r) => r.stream === s)?.first_seen_at ?? null));
  }

  /** Backfill rows by table / event / kind, and their paths. */
  async backfillCounts(): Promise<Record<string, number>> {
    const rows = await this.db.query<{ t: string; n: string }>(
      `select 'alerts' as t, count(*) as n from market_alerts where type = 'liq' and source = 'backfill' and event = 'alert'
       union all select 'continuations', count(*) from market_alerts where type = 'liq' and source = 'backfill' and event = 'continuing'
       union all select 'events', count(*) from market_alerts where type = 'liq' and source = 'backfill' and event = 'event'
       union all select 'event_continuations', count(*) from market_alerts where type = 'liq' and source = 'backfill' and event = 'event_continuing'
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
}

import { WebStreamsResponseSchema } from '@trade-automation/contracts';
import type { Db } from '../../src/db/db.port';
import { MetricsService } from '../../src/ops/metrics.service';
import { StreamRegistry } from '../../src/ops/stream-registry';
import { WebHealthController } from '../../src/web/health.controller';

/**
 * WD-009 — `/api/web/health/streams` carries the liquidation collectors' uptime (the SQL is in
 * `test/db/uptime-reads.integration.spec.ts`; the three-state rule in `liquidation-uptime.spec.ts`).
 * Pinned here: the route composes the three reads into the contract, and `gap-reports` is gone.
 */
const H = 3_600_000;

function fakeDb(now: number): Db {
  const db = {
    query: async (sql: string) => {
      if (sql.includes('from collector_heartbeats')) {
        return [{ stream: 'okx:liquidation-orders', venue: 'okx', market: 'perp', first_seen_at: new Date(now - 400 * H), last_seen_at: new Date(now - 5_000) }];
      }
      if (sql.includes('from collector_gaps')) return [];
      if (sql.includes('from liquidations')) return [{ venue: 'okx', last_ts: new Date(now - H), n24: '3', n7: '9' }];
      throw new Error(`unexpected query: ${sql}`);
    },
    transaction: async (fn: (d: Db) => unknown) => fn(db as Db),
  };
  return db as unknown as Db;
}

describe('WebHealthController /streams (WD-009)', () => {
  const streams = new StreamRegistry();

  it('adds the three liquidation streams, each with 24 h and 7 d windows, and parses as the contract', async () => {
    const res = await new WebHealthController(streams, new MetricsService(streams), fakeDb(Date.now())).getStreams();
    expect(WebStreamsResponseSchema.parse(res)).toEqual(res);
    expect(res.liquidationUptime.map((u) => u.venue)).toEqual(['binance', 'bybit', 'okx']);
    const okx = res.liquidationUptime[2];
    expect(okx.windows.map((w) => [w.hours, w.state, w.rows])).toEqual([[24, 'recorded', 3], [168, 'recorded', 9]]);
    // binance and bybit have no heartbeat in this fake: never "no events"
    expect(res.liquidationUptime[0]).toMatchObject({ instrumented: false });
    expect(res.liquidationUptime[0].windows.every((w) => w.state === 'not_recorded')).toBe(true);
  });

  it('without a database the block is empty, not an error', async () => {
    const res = await new WebHealthController(streams, new MetricsService(streams), null).getStreams();
    expect(res.liquidationUptime).toEqual([]);
  });

  it('the gap-reports route is gone with the candle tape it reported on', () => {
    expect((WebHealthController.prototype as unknown as Record<string, unknown>).getGapReports).toBeUndefined();
  });
});

import type { WebPositioningCell, WebPositioningRow } from '@trade-automation/contracts';
import { InsightsService } from '../../src/insights/insights.service';
import { TtlCache } from '../../src/venues/ttl-cache';

/**
 * IB-107 — the joint: a spark reaches the response only if the PORT's series reaches the snapshot.
 * Through the real service and the real rules; the ports are fakes of what web.module wires.
 */
const NOW = Date.UTC(2026, 10, 4, 12);
const c = (value: number | null, rarity: number | null, sample = 696): WebPositioningCell => ({ value, rarity, unavailable: rarity === null ? 'insufficient_history' : null, sample });
const sol: WebPositioningRow = {
  symbol: 'SOLUSDT', base: 'SOL', priceChangePct: c(0.1, 0.2), oiChangePct: c(26, 0.99), fundingRate: c(0.0001, 0.5, 90),
  lsGlobal: c(1.5, 0.5, 720), lsTopPosition: c(1.2, 0.5, 720), liqUsd: c(1000, null), oiUsd: null, quadrant: 'new_longs', signal: null,
};
const oi = Array.from({ length: 24 }, (_, i) => 1_000 + i * 10);
const service = (positioningSeries: () => Promise<Map<string, { oi: number[]; lsGlobal: number[]; funding: number[] }> | null>) =>
  new InsightsService({ cache: new TtlCache({ now: () => NOW }), now: () => NOW, ports: { positioning: async () => [sol], positioningSeries } });

describe('IB-107: InsightsService carries the ports\' series into each statement\'s spark', () => {
  it('the positioning series port feeds R4\'s spark (the coin\'s hourly OI)', async () => {
    const res = await service(async () => new Map([['SOLUSDT', { oi, lsGlobal: oi.map(() => 1.5), funding: [] }]])).insights('24h');
    const r4 = res.top.find((s) => s.ruleId === 'R4');
    expect(r4?.spark).toEqual({ values: oi, highlight: null });
  });

  it('a series port that fails costs the chart, not the statement', async () => {
    const res = await service(async () => { throw new Error('venue down'); }).insights('24h');
    expect(res.top.find((s) => s.ruleId === 'R4')).toMatchObject({ key: 'insight.oi_vs_price', spark: null });
  });
});

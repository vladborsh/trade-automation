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

/**
 * IB-113 (TL review): R11 is owner-first, on the same switch as the rest of the alerts. An admin always
 * sees it (to judge IB-111); anyone else only while members_visible; hidden, the other rules rank as if
 * R11 did not exist. One snapshot read serves both variants.
 */
describe('IB-113: R11 is owner-first (members_visible)', () => {
  const H = 3_600;
  const now = NOW / 1000;
  const alert = {
    id: 9, symbol: 'ETHUSDT', tf: '15m' as const, direction: 'bearish' as const,
    a: { time: now - 30 * H, price: 100, oiTime: now - 30 * H, oi: 1_000 },
    b: { time: now - 8 * H, price: 100.42, oiTime: now - 8 * H, oi: 997.7 },
    runOf: null, runLength: 2, params: { perTf: { '15m': { n: 6, k: 3, w: 96 }, '1h': { n: 6, k: 3, w: 120 }, '4h': { n: 6, k: 3, w: 90 } }, atrMult: 0.25, oiMedianMult: 0.5, priceLineTolAtrMult: 0, oiLineTolMedianMult: 0 }, // a round-1 row as read (V20)
    confirmedAt: now - 7 * H, firedAt: null, late: false, recipients: 0, priceAtFire: null, price4h: null, price24h: null, outcomeAt: null,
  };
  // the live case: R5 at rarity 1 with three coins beside R11
  const funding = (symbol: string, rate: number): WebPositioningRow => ({ ...sol, symbol, base: symbol.replace('USDT', ''), oiChangePct: c(1, 0.5), fundingRate: c(rate, 1, 90) });
  const rows = [funding('TRUMPUSDT', -0.0004), funding('AUSDT', 0.002), funding('BUSDT', 0.003), sol];
  const make = (membersVisible: boolean) => {
    const calls = { snapshot: 0 };
    const svc = new InsightsService({
      cache: new TtlCache({ now: () => NOW }), now: () => NOW,
      ports: {
        positioning: async () => { calls.snapshot++; return rows; },
        oiDivergence: async () => ({ alert, oiSeries: [1_000, 999, 997.7] }),
        oiAlertsMembersVisible: async () => membersVisible,
      },
    });
    return { svc, calls };
  };
  const positioningLine = (r: Awaited<ReturnType<InsightsService['insights']>>) => r.blocks.find((b) => b.block === 'positioning')?.statement?.ruleId;

  it('a MEMBER with the switch off: no R11 anywhere — R5 leads and holds positioning\'s line', async () => {
    const r = await make(false).svc.insights('24h', { admin: false });
    expect(r.top.map((s) => s.ruleId)).not.toContain('R11');
    expect(r.top[0]?.ruleId).toBe('R5');
    expect(['R5', 'R4']).toContain(positioningLine(r));
  });

  it('an ADMIN sees R11 first, switch off or not', async () => {
    const r = await make(false).svc.insights('24h', { admin: true });
    expect(r.top[0]?.ruleId).toBe('R11');
    expect(positioningLine(r)).toBe('R11');
  });

  it('a member sees R11 once members_visible is on', async () => {
    expect((await make(true).svc.insights('24h', { admin: false })).top[0]?.ruleId).toBe('R11');
  });

  it('one snapshot read serves both variants; a viewer not stated is hidden', async () => {
    const { svc, calls } = make(false);
    await svc.insights('24h', { admin: true });
    await svc.insights('24h', { admin: false });
    expect(calls.snapshot).toBe(1);
    expect((await svc.insights('24h')).top.map((s) => s.ruleId)).not.toContain('R11');
  });

  it('the visibility read failing hides R11 from members (soft, never shown by accident)', async () => {
    const svc = new InsightsService({
      cache: new TtlCache({ now: () => NOW }), now: () => NOW,
      ports: { positioning: async () => rows, oiDivergence: async () => ({ alert, oiSeries: [1, 2] }), oiAlertsMembersVisible: async () => { throw new Error('db down'); } },
    });
    expect((await svc.insights('24h', { admin: false })).top.map((s) => s.ruleId)).not.toContain('R11');
    expect((await svc.insights('24h', { admin: true })).top[0]?.ruleId).toBe('R11');
  });
});

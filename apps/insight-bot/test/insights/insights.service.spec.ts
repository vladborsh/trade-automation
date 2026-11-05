import type { WebPositioningCell, WebPositioningRow } from '@trade-automation/contracts';
import type { ChartReads } from '../../src/insights/charts/insight-charts';
import { InsightsService } from '../../src/insights/insights.service';
import { TtlCache } from '../../src/venues/ttl-cache';

/**
 * IB-119 — the joint: a chart reaches the response only through the service's `charts` port, after
 * ranking. Through the real service and the real rules; the reads are fakes of what web.module wires.
 */
const NOW = Date.UTC(2026, 10, 4, 12);
const c = (value: number | null, rarity: number | null, sample = 696): WebPositioningCell => ({ value, rarity, unavailable: rarity === null ? 'insufficient_history' : null, sample });
const sol: WebPositioningRow = {
  symbol: 'SOLUSDT', base: 'SOL', priceChangePct: c(0.1, 0.2), oiChangePct: c(26, 0.99), fundingRate: c(0.0001, 0.5, 90),
  lsGlobal: c(1.5, 0.5, 720), lsTopPosition: c(1.2, 0.5, 720), liqUsd: c(1000, null), oiUsd: null, priceRefTime: (NOW - 86_400_000) / 1000, quadrant: 'new_longs', signal: null,
};
function chartReads(over: Partial<ChartReads> = {}): { reads: ChartReads; calls: string[] } {
  const calls: string[] = [];
  const reads: ChartReads = {
    fundingSettlements: async () => new Map(),
    hourlyCloses: async () => [],
    closedKlines: async (coin, tf, fromMs, limit) => {
      calls.push(`klines:${coin}:${tf}:${limit}`);
      return Array.from({ length: limit }, (_, i) => ({ time: fromMs / 1000 + i * 300, open: 100, high: 101, low: 99, close: 100 + i / 100 }));
    },
    openInterest: async (coin, fromMs) => { calls.push(`oi:${coin}`); return Array.from({ length: 289 }, (_, i) => ({ time: fromMs / 1000 + i * 300, value: 1_000 + i })); },
    longShort: async () => [],
    liquidationMinutes: async () => [],
    oiReadings: async (coin) => { calls.push(`readings:${coin}`); return []; },
    ...over,
  };
  return { reads, calls };
}
const service = (reads: ChartReads) =>
  new InsightsService({ cache: new TtlCache({ now: () => NOW }), now: () => NOW, ports: { positioning: async () => [sol], charts: reads } });

describe('IB-119: InsightsService attaches each displayed statement\'s chart through the charts port', () => {
  it('R4\'s chart: price and OI from 0, from the reads the port wires', async () => {
    const { reads, calls } = chartReads();
    const res = await service(reads).insights('24h');
    const r4 = res.top.find((s) => s.ruleId === 'R4');
    expect(r4?.chart?.series.map((x) => [x.key, x.points[0]?.value])).toEqual([['price', 0], ['oi', 0]]);
    expect(calls.sort()).toEqual(['klines:SOLUSDT:5m:289', 'oi:SOLUSDT']); // the reference bar + 288 after it
  });

  it('a read that fails costs the chart, not the statement', async () => {
    const { reads } = chartReads({ closedKlines: async () => { throw new Error('venue down'); } });
    const res = await service(reads).insights('24h');
    expect(res.top.find((s) => s.ruleId === 'R4')).toMatchObject({ key: 'insight.oi_vs_price', chart: null });
  });

  it('no charts port: the statement still speaks, with no chart', async () => {
    const svc = new InsightsService({ cache: new TtlCache({ now: () => NOW }), now: () => NOW, ports: { positioning: async () => [sol] } });
    expect((await svc.insights('24h')).top.find((s) => s.ruleId === 'R4')).toMatchObject({ chart: null });
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
    id: 9, source: 'live' as const, symbol: 'ETHUSDT', tf: '15m' as const, direction: 'bearish' as const,
    a: { time: now - 30 * H, price: 100, oiTime: now - 30 * H, oi: 1_000 },
    b: { time: now - 8 * H, price: 100.42, oiTime: now - 8 * H, oi: 997.7 },
    runOf: null, runLength: 2, params: { perTf: { '15m': { n: 6, k: 3, w: 96 }, '1h': { n: 6, k: 3, w: 120 }, '4h': { n: 6, k: 3, w: 90 } }, atrMult: 0.25, oiMedianMult: 0.5, priceLineTolAtrMult: 0, oiLineTolMedianMult: 0 }, // a round-1 row as read (V20)
    confirmedAt: now - 7 * H, firedAt: null, late: false, recipients: 0, priceAtFire: null, price4h: null, price24h: null, outcomeAt: null,
  };
  // the live case: R5 at rarity 1 with three coins beside R11
  const funding = (symbol: string, rate: number): WebPositioningRow => ({ ...sol, symbol, base: symbol.replace('USDT', ''), oiChangePct: c(1, 0.5), fundingRate: c(rate, 1, 90) });
  const rows = [funding('TRUMPUSDT', -0.0004), funding('AUSDT', 0.002), funding('BUSDT', 0.003), sol];
  let r11Reads = chartReads();
  beforeEach(() => { r11Reads = chartReads(); });
  const make = (membersVisible: boolean) => {
    const calls = { snapshot: 0 };
    const svc = new InsightsService({
      cache: new TtlCache({ now: () => NOW }), now: () => NOW,
      ports: {
        positioning: async () => { calls.snapshot++; return rows; },
        oiDivergence: async () => ({ alert }),
        charts: r11Reads.reads,
        oiAlertsMembersVisible: async () => membersVisible,
      },
    });
    return { svc, calls };
  };
  const positioningLine = (r: Awaited<ReturnType<InsightsService['insights']>>) => r.blocks.find((b) => b.block === 'positioning')?.statement?.ruleId;

  it('a MEMBER with the switch off: no R11 anywhere — R5 leads and holds positioning\'s line', async () => {
    const r = await make(false).svc.insights('24h', { admin: false });
    expect(r.top.map((s) => s.ruleId)).not.toContain('R11');
    // IB-119: a hidden R11 is not displayed, so its chart is never read for
    expect(r11Reads.calls.filter((x) => x.includes('ETHUSDT'))).toEqual([]);
    expect(r.top[0]?.ruleId).toBe('R5');
    expect(['R5', 'R4']).toContain(positioningLine(r));
  });

  it('an ADMIN sees R11 first, switch off or not', async () => {
    const r = await make(false).svc.insights('24h', { admin: true });
    expect(r.top[0]?.ruleId).toBe('R11');
    expect(r.top[0]?.chart?.marks).toEqual([alert.a.time, alert.b.time]);
    // A − 2 bars … B + N (6) on 15m: 2 + 88 + 6 + 1 bars, one klines call
    expect(r11Reads.calls.filter((x) => x.includes('ETHUSDT')).sort()).toEqual(['klines:ETHUSDT:15m:97', 'readings:ETHUSDT']);
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
      ports: { positioning: async () => rows, oiDivergence: async () => ({ alert }), oiAlertsMembersVisible: async () => { throw new Error('db down'); } },
    });
    expect((await svc.insights('24h', { admin: false })).top.map((s) => s.ruleId)).not.toContain('R11');
    expect((await svc.insights('24h', { admin: true })).top[0]?.ruleId).toBe('R11');
  });
});

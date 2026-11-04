import type { WebInsightStatement, WebPositioningCell, WebPositioningRow } from '@trade-automation/contracts';
import { rank, runInsights } from '../../src/insights/engine';
import { R1, R2, R3, R4, R5, R6, R7, RULES } from '../../src/insights/rules';
import { isRefusal, type InsightSnapshot } from '../../src/insights/types';

/**
 * IB-086 — every rule as a table: snapshot → statement, or the rule MUST stay silent (an ordinary
 * day, a thin basis). The engine gates at rarity 0.90, so "silent" here means: refuses, returns
 * null, or reports a rarity under 0.90 that the engine drops — `shown()` applies that same gate.
 */
const NOW = Date.UTC(2026, 11, 3, 12);
const days = (n: number, hourly = false) => Array.from({ length: hourly ? n * 24 : n }, (_, i) => (i % 3 === 0 ? 100 : 200));
const shown = (out: ReturnType<typeof R1.run>): WebInsightStatement | null => (out && !isRefusal(out) && out.rarity >= 0.9 ? out : null);

function snapshot(over: Partial<InsightSnapshot> = {}): InsightSnapshot {
  return {
    period: '24h', nowMs: NOW,
    liquidations: {
      long: { usd: 200, sample: days(30) }, short: { usd: 150, sample: days(30) }, days: 30,
      hourly: days(30, true), hourlyDays: 30, venues: ['binance', 'bybit', 'okx'], fromMs: NOW - 30 * 86_400_000,
      coins: new Map([['BTCUSDT', { usd: 300_000, sample: days(30).map((x) => x * 2_000), days: 30 }]]),
      large: [],
    },
    positioning: [row('BTCUSDT', {})],
    breadth: { upShare: 0.5, altGapPct: 0.1, upShareSample: Array.from({ length: 696 }, (_, i) => 0.3 + (i % 5) * 0.1), altGapSample: Array.from({ length: 696 }, (_, i) => (i % 7) - 3), days: 30, coins: 30 },
    fng: 50,
    ...over,
  };
}
const c = (value: number | null, rarity: number | null, sample = 696): WebPositioningCell => ({ value, rarity, unavailable: rarity === null ? 'insufficient_history' : null, sample });
function row(symbol: string, o: Partial<Record<'price' | 'oi' | 'funding' | 'lsG' | 'lsT', WebPositioningCell>>): WebPositioningRow {
  return {
    symbol, base: symbol.replace('USDT', ''),
    priceChangePct: o.price ?? c(0.5, 0.4), oiChangePct: o.oi ?? c(1, 0.5), fundingRate: o.funding ?? c(0.0001, 0.5, 90),
    lsGlobal: o.lsG ?? c(1.5, 0.5, 720), lsTopPosition: o.lsT ?? c(1.2, 0.5, 720), liqUsd: c(1000, null), oiUsd: null, quadrant: 'flat', signal: null,
  };
}

describe('R1 liquidation surge by side', () => {
  it('a long side far above its norm speaks, with × median and basis', () => {
    const out = shown(R1.run(snapshot({ liquidations: { ...snapshot().liquidations!, long: { usd: 5_000, sample: days(30) } } })));
    expect(out).toMatchObject({ key: 'insight.liq_surge', params: { side: 'long', usd: 5_000, ratio: 25 }, basis: { window: '24h', sampleWindows: 30 } });
  });
  it('SILENT on an ordinary day', () => expect(shown(R1.run(snapshot()))).toBeNull());
  it('SILENT under 7 days of tape — refuses with insufficient_history', () => {
    const out = R1.run(snapshot({ liquidations: { ...snapshot().liquidations!, long: { usd: 5_000, sample: days(3) }, days: 3 } }));
    expect(out).toMatchObject({ refused: 'insufficient_history' });
  });
  it('SILENT for 7d (D14)', () => expect(R1.run(snapshot({ period: '7d' }))).toMatchObject({ refused: 'insufficient_history' }));
});

describe('R2 the coin with the most unusual liquidations', () => {
  const coins = (m: Map<string, { usd: number; sample: number[]; days: number }>) => snapshot({ liquidations: { ...snapshot().liquidations!, coins: m } });
  it('names the coin rarest against its own norm', () => {
    const out = shown(R2.run(coins(new Map([
      ['BTCUSDT', { usd: 300_000, sample: days(30).map((x) => x * 2_000), days: 30 }],
      ['SOLUSDT', { usd: 2_000_000, sample: days(30).map((x) => x * 1_000), days: 30 }],
    ]))));
    expect(out).toMatchObject({ params: { symbol: 'SOLUSDT' }, link: { route: 'instrument', symbol: 'SOLUSDT' } });
  });
  it('SILENT for a $40k alt, however unusual (USD floor)', () => {
    expect(R2.run(coins(new Map([['TINYUSDT', { usd: 40_000, sample: days(30).map(() => 10), days: 30 }]])))).toBeNull();
  });
  it('SILENT on a thin basis', () => {
    expect(R2.run(coins(new Map([['SOLUSDT', { usd: 2e6, sample: days(3), days: 3 }]])))).toMatchObject({ refused: 'insufficient_history' });
  });
});

describe('R3 cascade', () => {
  const ev = (minute: number, usd: number, symbol = 'ETHUSDT') => ({
    time: NOW / 1000 + minute * 60, symbol, base: 'ETH', side: 'short' as const, usd, price: 1, venue: 'binance',
    xMedian: null, seriesId: 'short-1', seriesCount: 4, seriesSpanSec: 540,
  });
  it('the period\'s largest series, rare against whole hours: "4 in 9 minutes", linked to its start', () => {
    const out = shown(R3.run(snapshot({ liquidations: { ...snapshot().liquidations!, large: [ev(0, 1e6), ev(3, 9e5), ev(6, 8e5), ev(9, 4e5)] } })));
    expect(out).toMatchObject({ params: { side: 'short', count: 4, minutes: 9, usd: 3.1e6, symbol: 'ETHUSDT' }, link: { timeSec: NOW / 1000 } });
  });
  it('SILENT without a series (large events alone are not a cascade)', () => {
    const lone = [{ ...ev(0, 5e6), seriesId: null, seriesCount: 0, seriesSpanSec: 0 }];
    expect(R3.run(snapshot({ liquidations: { ...snapshot().liquidations!, large: lone } }))).toBeNull();
  });
  it('SILENT on under 7 days of hourly tape', () => {
    expect(R3.run(snapshot({ liquidations: { ...snapshot().liquidations!, hourlyDays: 2, large: [ev(0, 1e6)] } }))).toMatchObject({ refused: 'insufficient_history' });
  });
});

describe('R4 OI vs price', () => {
  it('rare |ΔOI| on an ordinary |Δprice| speaks, named by quadrant', () => {
    const r = { ...row('SOLUSDT', { oi: c(26, 0.99), price: c(0.1, 0.2) }), quadrant: 'new_longs' as const };
    expect(shown(R4.run(snapshot({ positioning: [r] })))).toMatchObject({ params: { symbol: 'SOLUSDT', quadrant: 'new_longs', oiPct: 26 } });
  });
  it('IB-BUG-023: links to the START of the period it measures (a change has no single moment), per period', () => {
    const r = { ...row('SOLUSDT', { oi: c(26, 0.99), price: c(0.1, 0.2) }), quadrant: 'new_longs' as const };
    for (const [period, sec] of [['1h', 3_600], ['4h', 14_400], ['24h', 86_400]] as const) {
      expect(shown(R4.run(snapshot({ period, positioning: [r] })))?.link).toEqual({ route: 'instrument', symbol: 'SOLUSDT', timeSec: NOW / 1000 - sec });
    }
  });
  it('IB-BUG-027: a FLAT quadrant is not a statement — a rare-for-the-coin +0.81 % is still «без изменений»', () => {
    // why it fired: rarity is the coin's OWN history (XRP's OI barely moves, so +0.81 % was rare),
    // the quadrant is absolute (|OI| < OI_FLAT_PCT = 1 % → flat). Design D5: R4 is named by one of
    // the four quadrants; flat is not one of them.
    const flat = { ...row('XRPUSDT', { oi: c(0.81, 0.99), price: c(-0.62, 0.3) }), quadrant: 'flat' as const };
    expect(shown(R4.run(snapshot({ positioning: [flat] })))).toBeNull();
    const named = { ...row('SOLUSDT', { oi: c(6, 0.93), price: c(0.4, 0.3) }), quadrant: 'new_longs' as const };
    expect(shown(R4.run(snapshot({ positioning: [flat, named] })))).toMatchObject({ params: { symbol: 'SOLUSDT', quadrant: 'new_longs' } });
  });
  it('SILENT when price is rare too (that is a price story, not an OI one)', () => {
    expect(shown(R4.run(snapshot({ positioning: [row('SOLUSDT', { oi: c(26, 0.99), price: c(9, 0.98) })] })))).toBeNull();
  });
  it('SILENT under 20 days (no rarity measured anywhere)', () => {
    expect(R4.run(snapshot({ positioning: [row('SOLUSDT', { oi: c(26, null), price: c(0.1, null) })] }))).toMatchObject({ refused: 'insufficient_history' });
  });
});

describe('R5 funding extremes', () => {
  it('counts coins beyond their own p95/p5 and names the most extreme', () => {
    const rows = [row('A', { funding: c(0.001, 0.97, 90) }), row('B', { funding: c(-0.0008, 0.93, 90) }), row('C', {})];
    expect(shown(R5.run(snapshot({ positioning: rows })))).toMatchObject({ params: { count: 2, total: 3, symbol: 'A' } });
  });
  it('SILENT on an ordinary day', () => expect(R5.run(snapshot())).toBeNull());
});

describe('R6 crowd vs top traders', () => {
  it('opposite sides of 1, both rare', () => {
    expect(shown(R6.run(snapshot({ positioning: [row('ETHUSDT', { lsG: c(2.6, 0.95, 720), lsT: c(0.7, 0.92, 720) })] }))))
      .toMatchObject({ params: { symbol: 'ETHUSDT', global: 2.6, top: 0.7 } });
  });
  it('SILENT when both lean the same way, however rare', () => {
    expect(R6.run(snapshot({ positioning: [row('ETHUSDT', { lsG: c(2.6, 0.95, 720), lsT: c(1.7, 0.92, 720) })] }))).toBeNull();
  });
});

describe('R7 breadth', () => {
  it('a rare breadth speaks, with the F&G band for the wording', () => {
    const out = shown(R7.run(snapshot({ fng: 20, breadth: { ...snapshot().breadth!, upShare: 0.05 } })));
    expect(out).toMatchObject({ key: 'insight.breadth', params: { upPct: 5, fngBand: 'extreme_fear' } });
  });
  it('SILENT on an ordinary day', () => expect(shown(R7.run(snapshot()))).toBeNull());
  it('SILENT under 20 days', () => expect(R7.run(snapshot({ breadth: { ...snapshot().breadth!, days: 5 } }))).toMatchObject({ refused: 'insufficient_history' }));
});

describe('the engine', () => {
  it('ranks by rarity, then |magnitude|, and returns at most five', () => {
    const st = (rarity: number, magnitude: number) => ({ rarity, magnitude } as WebInsightStatement);
    expect([st(0.95, 1), st(0.99, 1), st(0.95, -9)].sort(rank).map((x) => [x.rarity, x.magnitude])).toEqual([[0.99, 1], [0.95, -9], [0.95, 1]]);
  });

  it('drops anything under 0.90, and a thrown rule does not take the page down', () => {
    const boom = { id: 'R1' as const, block: 'liquidations' as const, run: () => { throw new Error('bug'); } };
    const out = runInsights([boom, R7], snapshot());
    expect(out.top).toEqual([]);
    expect(out.blocks).toHaveLength(5);
  });

  it('THE BOX\'S FIRST WEEK: liquidation rules silent WITH THE REASON; OI/funding still speak', () => {
    const first = snapshot({
      liquidations: { ...snapshot().liquidations!, long: { usd: 9e6, sample: days(2) }, days: 2, hourlyDays: 2,
        coins: new Map([['SOLUSDT', { usd: 5e6, sample: days(2), days: 2 }]]) },
      positioning: [{ ...row('SOLUSDT', { oi: c(26, 0.99), price: c(0.1, 0.2), funding: c(0.001, 0.97, 90) }), quadrant: 'new_longs' }],
    });
    const out = runInsights(RULES, first);
    expect(out.blocks[0]).toMatchObject({ block: 'liquidations', statement: null, neutral: { reason: 'insufficient_history' } });
    expect(out.top.map((s) => s.ruleId).sort()).toEqual(['R4', 'R5']);
    expect(out.blocks[1]).toMatchObject({ block: 'positioning', statement: { ruleId: 'R4' } });
    expect(out.blocks[2].neutral?.reason).toBe('no_rules'); // caps: phase 2
  });

  it('an ordinary day: no statements, every block with a neutral line', () => {
    const out = runInsights(RULES, snapshot());
    expect(out.top).toEqual([]);
    expect(out.blocks.map((b) => b.neutral?.reason)).toEqual(['nothing_unusual', 'nothing_unusual', 'no_rules', 'no_rules', 'nothing_unusual']);
  });
});

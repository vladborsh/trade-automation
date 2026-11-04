import type { WebFlowsResponse, WebInsightStatement, WebPositioningCell, WebPositioningRow } from '@trade-automation/contracts';
import { neutralReason, rank, runInsights } from '../../src/insights/engine';
import { R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, RULES } from '../../src/insights/rules';
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
      // IB-107: 24 hourly bars, the two sides different so a spark can say which side it drew
      bars: Array.from({ length: 24 }, (_, i) => ({ time: NOW / 1000 - (23 - i) * 3_600, long: 1_000 + i, short: 5_000 + i })),
    },
    positioning: [row('BTCUSDT', {})],
    positioningSeries: null,
    breadth: { upShare: 0.5, altGapPct: 0.1, upShareSample: Array.from({ length: 696 }, (_, i) => 0.3 + (i % 5) * 0.1), altGapSample: Array.from({ length: 696 }, (_, i) => (i % 7) - 3), days: 30, coins: 30 },
    fng: 50,
    flows: null,
    oiDivergence: null,
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
    const boom = { id: 'R1' as const, block: 'liquidations' as const, sources: ['tape'] as const, run: () => { throw new Error('bug'); } };
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
    // IB-091: the flows block has rules now; on the captured example (DVOL +1.08 at rarity 0.71, …) they run and stay under 0.90
    const out = runInsights(RULES, snapshot({ flows: flowsExample }));
    expect(out.top).toEqual([]);
    expect(out.blocks.map((b) => b.neutral?.reason)).toEqual(['nothing_unusual', 'nothing_unusual', 'no_rules', 'nothing_unusual', 'nothing_unusual']);
  });
});

// ---- IB-091 R8–R10 («Деривативы и потоки»), on the contract's real example ----------------------
// eslint-disable-next-line @typescript-eslint/no-var-requires
const flowsExample = require('../../../../libs/contracts/test/fixtures/flows.24h.json') as WebFlowsResponse;
const flows = (over: { dvol?: Partial<WebFlowsResponse['dvol']>; stablecoins?: Partial<WebFlowsResponse['stablecoins']>; coinbasePremium?: Partial<WebFlowsResponse['coinbasePremium']> }): WebFlowsResponse => ({
  ...flowsExample,
  dvol: { ...flowsExample.dvol, ...over.dvol },
  stablecoins: { ...flowsExample.stablecoins, ...over.stablecoins },
  coinbasePremium: { ...flowsExample.coinbasePremium, ...over.coinbasePremium },
});
const ch = (value: number, rarity: number | null) => ({ value, rarity, sample: 600, sampleDays: 25 });

describe('R8 DVOL spike — rise only (TL ruling)', () => {
  it('a rare RISE speaks; a rare FALL does not (a spike is a rise)', () => {
    expect(shown(R8.run(snapshot({ flows: flows({ dvol: { change: ch(6.5, 0.97) } }) })))).toMatchObject({ key: 'insight.dvol_spike', params: { change: 6.5 } });
    expect(R8.run(snapshot({ flows: flows({ dvol: { change: ch(-6.5, 0.97) } }) }))).toBeNull();
  });
  it('refuses a thin history, and says no data without the source', () => {
    expect(R8.run(snapshot({ flows: flows({ dvol: { change: ch(6.5, null) } }) }))).toMatchObject({ refused: 'insufficient_history' });
    expect(R8.run(snapshot({ flows: null }))).toMatchObject({ refused: 'no_data' });
  });
});

describe('R9 stablecoin supply — two-sided', () => {
  it('a rare BURN speaks as a mint would; the basis names the 1-day (or 7-day) change it measured', () => {
    const burn = shown(R9.run(snapshot({ flows: flows({ stablecoins: { changeUsd: ch(-4e9, 0.98), changePct: -1.4, changeDays: 1 } }) })));
    expect(burn).toMatchObject({ key: 'insight.stablecoin_supply', params: { usd: -4e9, days: 1 }, magnitude: 4e9 });
    expect(burn?.basis.window).toBe('24h');
    const week = R9.run(snapshot({ period: '7d', flows: flows({ stablecoins: { changeUsd: ch(9e9, 0.95), changePct: 3, changeDays: 7 } }) }));
    expect(isRefusal(week) ? null : week?.basis.window).toBe('7d');
  });
});

describe('R10 Coinbase premium — D18', () => {
  const prem = (over: Partial<WebFlowsResponse['coinbasePremium']>) => snapshot({ flows: flows({ coinbasePremium: { premiumPct: ch(0.18, 0.96), minutes: 60, sameSignMinutes: 58, unavailable: null, ...over } }) });
  it('sustained (≥ 45 of the valid minutes share the sign) and rare: speaks, two-sided', () => {
    expect(shown(R10.run(prem({})))).toMatchObject({ key: 'insight.coinbase_premium', params: { pct: 0.18, minutes: 58 } });
    expect(shown(R10.run(prem({ premiumPct: ch(-0.18, 0.96) })))).toMatchObject({ params: { pct: -0.18 } });
  });
  it('44 valid minutes: REFUSES insufficient_minutes (D18) — however rare the value', () => {
    expect(R10.run(prem({ minutes: 44, sameSignMinutes: 44, unavailable: 'insufficient_minutes' }))).toMatchObject({ refused: 'insufficient_minutes' });
  });
  it('a premium that flips sign is not sustained: silent', () => {
    expect(R10.run(prem({ sameSignMinutes: 40 }))).toBeNull();
  });
  it('the flows block line says insufficient_minutes when that is why nothing was said', () => {
    const s = snapshot({ flows: flows({ dvol: { value: null, change: null }, stablecoins: { supplyUsd: null, changeUsd: null }, coinbasePremium: { premiumPct: ch(0.1, 0.5), minutes: 30, sameSignMinutes: 30, unavailable: 'insufficient_minutes' } }) });
    expect(runInsights(RULES, s).blocks.find((b) => b.block === 'flows')?.neutral?.reason).toBe('insufficient_minutes');
  });
});

describe('IB-BUG-028: a block whose rules could not look says so, and names the source', () => {
  const line = (snap: InsightSnapshot, block: string) => runInsights(RULES, snap).blocks.find((b) => b.block === block)?.neutral;
  it('every rule refused for no_data → source_unavailable with the block\'s sources, never «nothing unusual»', () => {
    expect(line(snapshot({ flows: null }), 'flows')).toMatchObject({ reason: 'source_unavailable', sources: ['deribit', 'defillama', 'coinbase', 'binance'] });
    expect(line(snapshot({ liquidations: null }), 'liquidations')).toMatchObject({ reason: 'source_unavailable', sources: ['tape'] });
  });
  it('mixed — one rule looked and found nothing rare — is «nothing unusual»', () => {
    const onlyDvol = snapshot({ flows: flows({ stablecoins: { supplyUsd: null, changeUsd: null }, coinbasePremium: { premiumPct: null, unavailable: 'source_unavailable' } }) });
    expect(line(onlyDvol, 'flows')).toMatchObject({ reason: 'nothing_unusual' });
    expect(line(onlyDvol, 'flows')?.sources).toBeUndefined();
  });
  it('precedence: a thin history still says so before a missing source', () => {
    const rules = [R8, R9];
    expect(neutralReason(rules, [{ refused: 'insufficient_history', basis: null }, { refused: 'no_data', basis: null }]).reason).toBe('insufficient_history');
    expect(neutralReason(rules, [{ refused: 'no_data', basis: null }, { refused: 'no_data', basis: null }])).toEqual({ reason: 'source_unavailable', sources: ['deribit', 'defillama'] });
    expect(neutralReason(rules, [{ refused: 'no_data', basis: null }]).reason).toBe('nothing_unusual'); // one ran
  });
});


/**
 * IB-107 (design D24, §7.3) — every rule's spark: non-null when it speaks, drawn from ITS OWN series
 * (each fixture holds a neighbouring series that differs, so a rule reading the wrong one fails),
 * the §7.3 length and highlight, and null when the series is not in hand. No rule fetches for it.
 */
describe('IB-107 sparks: each rule draws its mini-chart from the series it already read', () => {
  const ramp = (n: number, from: number, step = 1) => Array.from({ length: n }, (_, i) => from + i * step);
  const series = (oi: number[], lsGlobal: number[], funding: number[]) => new Map([['SOLUSDT', { oi, lsGlobal, funding }], ['ETHUSDT', { oi, lsGlobal, funding }]]);

  it('R1: the named side\'s bars, last 24, now lit; one bar (1h) is no chart', () => {
    const big = { ...snapshot().liquidations!, short: { usd: 5_000, sample: days(30) } };
    const out = shown(R1.run(snapshot({ liquidations: big })));
    expect(out?.params['side']).toBe('short');
    expect(out?.spark).toEqual({ values: ramp(24, 5_000), highlight: 23 });
    const one = shown(R1.run(snapshot({ liquidations: { ...big, bars: big.bars.slice(-1) } })));
    expect(one).not.toBeNull();
    expect(one?.spark).toBeNull();
  });

  it('R2: the coin\'s own sample, last 14 windows, then the current one, lit', () => {
    const sample = ramp(30, 10_000, 1_000);
    const out = shown(R2.run(snapshot({ liquidations: { ...snapshot().liquidations!, coins: new Map([['SOLUSDT', { usd: 2_000_000, sample, days: 30 }]]) } })));
    expect(out?.spark).toEqual({ values: [...sample.slice(-14), 2_000_000], highlight: 14 });
  });

  it('R3: the market\'s bars of the cascade\'s side, the cascade\'s hour lit (not "now")', () => {
    const ev = (minute: number, usd: number) => ({
      time: NOW / 1000 - 5 * 3_600 + minute * 60, symbol: 'ETHUSDT', base: 'ETH', side: 'long' as const, usd, price: 1, venue: 'binance',
      xMedian: null, seriesId: 'long-1', seriesCount: 4, seriesSpanSec: 540,
    });
    const out = shown(R3.run(snapshot({ liquidations: { ...snapshot().liquidations!, large: [ev(0, 1e6), ev(3, 9e5), ev(6, 8e5), ev(9, 4e5)] } })));
    expect(out).not.toBeNull();
    expect(out?.spark).toEqual({ values: ramp(24, 1_000), highlight: 18 }); // bar 18 starts 5 h before NOW
  });

  it('R4: the coin\'s hourly OI, last 24, nothing lit (points ≤ 1 h old; the title\'s figure is current)', () => {
    const r = { ...row('SOLUSDT', { oi: c(26, 0.99), price: c(0.1, 0.2) }), quadrant: 'new_longs' as const };
    const out = shown(R4.run(snapshot({ positioning: [r], positioningSeries: series(ramp(30, 100), ramp(30, 1.5, 0.01), ramp(30, 0.0001, 0.00001)) })));
    expect(out?.spark).toEqual({ values: ramp(24, 106), highlight: null });
    expect(shown(R4.run(snapshot({ positioning: [r], positioningSeries: null })))?.spark).toBeNull();
  });

  it('R5: the named coin\'s last 21 funding settlements, last lit', () => {
    const rows = [row('SOLUSDT', { funding: c(0.001, 0.97, 90) }), row('C', {})];
    const funding = ramp(90, 0.0001, 0.00001);
    const out = shown(R5.run(snapshot({ positioning: rows, positioningSeries: series(ramp(30, 100), ramp(30, 1.5, 0.01), funding) })));
    expect(out?.spark).toEqual({ values: funding.slice(-21), highlight: 20 });
  });

  it('R6: the coin\'s global ACCOUNT L/S, last 24 hourly points', () => {
    const lsG = ramp(30, 1.5, 0.01);
    const out = shown(R6.run(snapshot({ positioning: [row('ETHUSDT', { lsG: c(2.6, 0.95, 720), lsT: c(0.7, 0.92, 720) })], positioningSeries: series(ramp(30, 100), lsG, ramp(30, 0.0001)) })));
    expect(out?.spark).toEqual({ values: lsG.slice(-24), highlight: null });
  });

  it('R7: the series that made it speak — share up (in %), or the signed alt gap — with now lit', () => {
    const up = shown(R7.run(snapshot({ fng: 20, breadth: { ...snapshot().breadth!, upShare: 0.05 } })));
    expect(up?.spark?.values).toHaveLength(24);
    expect(up?.spark?.values.at(-1)).toBeCloseTo(5);
    expect(up?.spark?.values.slice(0, -1)).toEqual(snapshot().breadth!.upShareSample.slice(-23).map((x) => x * 100));
    expect(up?.spark?.highlight).toBe(23);
    const gap = shown(R7.run(snapshot({ breadth: { ...snapshot().breadth!, altGapPct: -9 } })));
    expect(gap?.spark).toEqual({ values: [...snapshot().breadth!.altGapSample.slice(-23), -9], highlight: 23 });
  });

  it('R8 / R9: the tile\'s own series, last 30 points, last lit', () => {
    const r8 = shown(R8.run(snapshot({ flows: flows({ dvol: { change: ch(6.5, 0.97) } }) })));
    expect(r8?.spark).toEqual({ values: flowsExample.dvol.series.slice(-30).map((p) => p.value), highlight: flowsExample.dvol.series.slice(-30).length - 1 });
    const r9 = shown(R9.run(snapshot({ flows: flows({ stablecoins: { changeUsd: ch(-4e9, 0.98), changePct: -1.4, changeDays: 1 } }) })));
    expect(r9?.spark).toEqual({ values: flowsExample.stablecoins.series.slice(-30).map((p) => p.value), highlight: 29 });
  });

  it('R10: the last hour\'s minutes as 30 two-minute means (signed), last lit', () => {
    const t0 = 1_793_758_000;
    const minutes = Array.from({ length: 75 }, (_, i) => ({ time: t0 + i * 60, value: i < 15 ? 9 : -(i - 15) }));
    const out = shown(R10.run(snapshot({ flows: flows({ coinbasePremium: { premiumPct: ch(-0.18, 0.96), minutes: 60, sameSignMinutes: 58, unavailable: null, series: minutes } }) })));
    // the 15 older minutes (value 9) are outside the last hour: the means are of −0…−59, pairwise
    expect(out?.spark).toEqual({ values: Array.from({ length: 30 }, (_, k) => -(2 * k + 0.5)), highlight: 29 });
  });

  it('no series in hand → null, and the statement still speaks', () => {
    const r = { ...row('SOLUSDT', { oi: c(26, 0.99), price: c(0.1, 0.2) }), quadrant: 'new_longs' as const };
    const empty = series([], [], []);
    expect(shown(R4.run(snapshot({ positioning: [r], positioningSeries: empty })))).toMatchObject({ key: 'insight.oi_vs_price', spark: null });
    expect(shown(R8.run(snapshot({ flows: flows({ dvol: { change: ch(6.5, 0.97), series: [] } }) })))).toMatchObject({ key: 'insight.dvol_spike', spark: null });
  });
});

describe('R11 the OI divergence alert (IB-113, V16)', () => {
  const alert = {
    id: 9, symbol: 'BTCUSDT', tf: '1h' as const, direction: 'bullish' as const,
    a: { time: NOW / 1000 - 30 * 3_600, price: 100, oiTime: NOW / 1000 - 30 * 3_600, oi: 1_000 },
    b: { time: NOW / 1000 - 8 * 3_600, price: 98.2, oiTime: NOW / 1000 - 8 * 3_600, oi: 1_032 },
    runOf: null, runLength: 2, params: { perTf: { '15m': { n: 6, k: 3, w: 96 }, '1h': { n: 6, k: 3, w: 120 }, '4h': { n: 6, k: 3, w: 90 } }, atrMult: 0.25, oiMedianMult: 0.5 },
    confirmedAt: NOW / 1000 - 3_600, firedAt: null, late: false, recipients: 0, priceAtFire: null, price4h: null, price24h: null, outcomeAt: null,
  };
  it('shows the journal\'s alert: B against A, an EVENT (rarity 1, ranks first), the chart at B, the OI series as its spark', () => {
    const out = R11.run(snapshot({ oiDivergence: { alert, oiSeries: [1_000, 990, 1_010, 1_032] } })) as WebInsightStatement;
    expect(out).toMatchObject({ ruleId: 'R11', block: 'positioning', key: 'insight.oi_divergence', rarity: 1, link: { route: 'instrument', symbol: 'BTCUSDT', timeSec: alert.b.time } });
    expect(out.params).toMatchObject({ symbol: 'BTCUSDT', tf: '1h', direction: 'bullish', runLength: 2 });
    expect(out.params['pricePct'] as number).toBeCloseTo(-1.8, 6);
    expect(out.params['oiPct'] as number).toBeCloseTo(3.2, 6);
    expect(out.spark).toEqual({ values: [1_000, 990, 1_010, 1_032], highlight: 3 });
    expect(shown(out)).not.toBeNull(); // the 0.90 gate lets an event through
  });
  it('no alert in the window → silent (null), not a refusal: the block\'s other rules decide its line', () => {
    expect(R11.run(snapshot())).toBeNull();
  });
  it('ranks first even against a percentile that ALSO reached 1 with a bigger magnitude (the live case: R5 at 1, three coins)', () => {
    const rows = [row('TRUMPUSDT', { funding: c(-0.0004, 1, 90) }), row('A', { funding: c(0.002, 1, 90) }), row('B', { funding: c(0.003, 1, 90) })];
    // the live numbers: OI +0.2 % (magnitude 0.2) against three coins (magnitude 3) — magnitude alone would put R5 first
    const small = { ...alert, b: { ...alert.b, oi: 1_002 } };
    const out = runInsights(RULES, snapshot({ positioning: rows, oiDivergence: { alert: small, oiSeries: [1, 2] } }));
    expect(out.top.map((x) => x.ruleId).slice(0, 2)).toEqual(['R11', 'R5']);
    expect(out.blocks.find((b) => b.block === 'positioning')?.statement?.ruleId).toBe('R11');
  });
  it('ranks first in its block over a rare-but-not-certain statement', () => {
    const r4row = { ...row('SOLUSDT', { oi: c(26, 0.99), price: c(0.1, 0.2) }), quadrant: 'new_longs' as const };
    const out = runInsights(RULES, snapshot({ positioning: [r4row], oiDivergence: { alert, oiSeries: [1, 2] } }));
    expect(out.blocks.find((b) => b.block === 'positioning')?.statement?.ruleId).toBe('R11');
    expect(out.top[0]?.ruleId).toBe('R11');
  });
});

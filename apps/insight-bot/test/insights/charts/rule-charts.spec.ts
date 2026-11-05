import {
  WEB_INSIGHT_CHART_MAX_POINTS, WebInsightChartSchema, WebInsightsResponseSchema, type WebFlowsResponse, type WebInsightChart, type WebInsightStatement,
  type WebPositioningCell, type WebPositioningRow,
} from '@trade-automation/contracts';
import { levelBand, pctFromFirst, thin, upperBand } from '../../../src/insights/charts/chart-math';
import { attachCharts, chartFor, type ChartReads } from '../../../src/insights/charts/insight-charts';
import { r11Bars, r4PriceLine, r4Window } from '../../../src/insights/charts/rule-charts';
import { runInsights } from '../../../src/insights/engine';
import { levelRarity, rarity } from '../../../src/insights/rarity';
import { R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, RULES } from '../../../src/insights/rules';
import { isRefusal, type InsightSnapshot, type Rule } from '../../../src/insights/types';
import { TtlCache } from '../../../src/venues/ttl-cache';
import { refBarCloseMs } from '../../../src/web/market/positioning/price-ref';

/**
 * IB-119 (market round 2 §3) — one spec per rule: WHICH series the chart draws and WHICH reference
 * line, from the rule's own data; every fixture holds a neighbouring series that differs, so a chart
 * reading the wrong one fails. Plus: R5's band is the rarity's own sample, the 300-point limit, and
 * charts are built only for the displayed statements.
 */
const NOW = Date.UTC(2026, 10, 5, 12, 2);
const NOW_S = NOW / 1000;
const ramp = (n: number, from: number, step = 1) => Array.from({ length: n }, (_, i) => from + i * step);
const days = (n: number, hourly = false) => Array.from({ length: hourly ? n * 24 : n }, (_, i) => (i % 3 === 0 ? 100 : 200));
const c = (value: number | null, r: number | null, sample = 696): WebPositioningCell => ({ value, rarity: r, unavailable: r === null ? 'insufficient_history' : null, sample });
function row(symbol: string, o: Partial<Record<'price' | 'oi' | 'funding' | 'lsG' | 'lsT', WebPositioningCell>>): WebPositioningRow {
  return {
    symbol, base: symbol.replace('USDT', ''),
    priceChangePct: o.price ?? c(0.5, 0.4), oiChangePct: o.oi ?? c(1, 0.5), fundingRate: o.funding ?? c(0.0001, 0.5, 90),
    lsGlobal: o.lsG ?? c(1.5, 0.5, 720), lsTopPosition: o.lsT ?? c(1.2, 0.5, 720), liqUsd: c(1000, null), oiUsd: null, priceRefTime: null, quadrant: 'flat', signal: null,
  };
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const flowsExample = require('../../../../../libs/contracts/test/fixtures/flows.24h.json') as WebFlowsResponse;
const ch = (value: number, r: number | null) => ({ value, rarity: r, sample: 600, sampleDays: 25 });

function snapshot(over: Partial<InsightSnapshot> = {}): InsightSnapshot {
  return {
    period: '24h', nowMs: NOW,
    liquidations: {
      long: { usd: 200, sample: days(30) }, short: { usd: 150, sample: days(30) }, days: 30,
      hourly: days(30, true), hourlyDays: 30, venues: ['binance'], fromMs: NOW - 30 * 86_400_000,
      coins: new Map([['BTCUSDT', { usd: 300_000, sample: days(30).map((x) => x * 2_000), days: 30 }]]),
      large: [],
      bars: Array.from({ length: 24 }, (_, i) => ({ time: NOW_S - (23 - i) * 3_600, long: 1_000 + i, short: 5_000 + i })),
    },
    positioning: [row('BTCUSDT', {})],
    breadth: { upShare: 0.05, altGapPct: 0.1, upShareSample: ramp(696, 0, 0.001).map((x) => 0.3 + (x % 0.4)), altGapSample: ramp(696, 0).map((i) => (i % 7) - 3), days: 30, coins: 30, lastHourEnd: NOW_S - 120 },
    fng: 50, flows: null, oiDivergence: null, fundingIntervalH: null,
    ...over,
  };
}
const said = (rule: Rule, s: InsightSnapshot): WebInsightStatement => {
  const out = rule.run(s);
  if (out === null || isRefusal(out)) throw new Error(`${rule.id} did not speak`);
  return out;
};

/** Fake reads: every call counted; each series distinct, so a swapped series is visible. */
function reads(over: Partial<ChartReads> = {}) {
  const calls: string[] = [];
  const r: ChartReads = {
    fundingSettlements: async () => { calls.push('funding'); return new Map(); },
    hourlyCloses: async (coin, fromMs) => { calls.push(`closes:${coin}:${fromMs}`); return ramp(168, 0).map((i) => ({ time: fromMs / 1000 + i * 3_600, value: 100 + i })); },
    closedKlines: async (coin, tf, fromMs, limit) => {
      calls.push(`klines:${coin}:${tf}:${fromMs}:${limit}`);
      const sec = { '5m': 300, '15m': 900, '1h': 3_600, '4h': 14_400 }[tf];
      return ramp(limit, 0).map((i) => ({ time: fromMs / 1000 + i * sec, open: 50 + i, high: 60 + i, low: 40 + i, close: 51 + i }));
    },
    openInterest: async (coin, fromMs, toMs, minPeriodMs) => { calls.push(`oi:${coin}:${minPeriodMs}`); return ramp(289, 0).map((i) => ({ time: fromMs / 1000 + i * 300, value: 1_000 - i })); },
    longShort: async (coin, kind) => { calls.push(`ls:${coin}:${kind}`); return ramp(288, 0).map((i) => ({ time: NOW_S - (287 - i) * 300, ratio: kind === 'global_account' ? 2 + i / 1000 : 0.8 })); },
    liquidationMinutes: async (fromMs, toMs) => { calls.push(`minutes:${fromMs}:${toMs}`); return []; },
    oiReadings: async (coin) => { calls.push(`readings:${coin}`); return []; },
    ...over,
  };
  return { r, calls };
}
const cache = () => new TtlCache({ now: () => NOW });
const valid = (chart: WebInsightChart | null) => {
  expect(chart).not.toBeNull();
  expect(WebInsightChartSchema.safeParse(chart).success).toBe(true);
  return chart as WebInsightChart;
};
const keys = (chart: WebInsightChart) => chart.series.map((s) => s.key);

describe('R1 liquidation surge: both sides of the period\'s bars, shorts above, ref 0, the current bar lit', () => {
  it('draws the overview\'s bars, not a sample', async () => {
    const s = snapshot({ liquidations: { ...snapshot().liquidations!, short: { usd: 5_000, sample: days(30) } } });
    const chart = valid(await chartFor(said(R1, s), s, null, cache()));
    expect(chart).toMatchObject({ kind: 'bars_mirror', unit: 'usd', ref: 0, band: null, highlight: { from: NOW_S, to: NOW_S } });
    expect(keys(chart)).toEqual(['short', 'long']);
    expect(chart.series[0]?.points.map((p) => p.value)).toEqual(ramp(24, 5_000));
    expect(chart.series[1]?.points.map((p) => p.value)).toEqual(ramp(24, 1_000));
  });
});

describe('R2 one coin: its last 14 windows + the current one, the band from the SAME sample as its rarity', () => {
  it('bars at the window ends, the current at now, a one-sided band', async () => {
    const sample = ramp(30, 10_000, 1_000);
    const s = snapshot({ liquidations: { ...snapshot().liquidations!, coins: new Map([['SOLUSDT', { usd: 2_000_000, sample, days: 30 }]]) } });
    const chart = valid(await chartFor(said(R2, s), s, null, cache()));
    expect(chart).toMatchObject({ kind: 'bars', unit: 'usd', ref: 0, highlight: { from: NOW_S, to: NOW_S } });
    expect(chart.series[0]?.points.map((p) => p.value)).toEqual([...sample.slice(-14), 2_000_000]);
    expect(chart.series[0]?.points.at(-2)?.time).toBe(Math.floor(NOW_S / 86_400) * 86_400); // the last complete day ended at midnight
    expect(chart.band).toEqual(upperBand(sample, 0.9));
  });
  it('a value above the band is exactly a value the rule calls rare', () => {
    const sample = [0, 0, 0, 5, 7, 7, 9, 12, 30, 31, 40, 55, 60, 61, 90, 100, 120, 121, 300, 1_000];
    const band = upperBand(sample, 0.9) as { hi: number };
    for (const v of [...sample, 0.5, 130, 299, 301, 999, 1_001, 5_000]) {
      const r = rarity(v, sample) as number;
      if (v !== band.hi) expect([v, v > band.hi]).toEqual([v, r >= 0.9]);
    }
  });
});

describe('R3 cascade: 1-minute sums of BOTH sides, ±15 min, the cascade\'s minutes lit — our tape, cached 5 min', () => {
  const ev = (minute: number, usd: number) => ({
    time: NOW_S - 3_600 + minute * 60, symbol: 'ETHUSDT', base: 'ETH', side: 'short' as const, usd, price: 1, venue: 'binance',
    xMedian: null, seriesId: 'short-1', seriesCount: 4, seriesSpanSec: 540,
  });
  const s = snapshot({ liquidations: { ...snapshot().liquidations!, large: [ev(0, 1e6), ev(3, 9e5), ev(6, 8e5), ev(9, 4e5)] } });
  it('reads the window round the cascade and fills empty minutes with 0', async () => {
    const start = NOW_S - 3_600;
    const calls: string[] = [];
    const { r } = reads({ liquidationMinutes: async (fromMs, toMs) => { calls.push(`minutes:${fromMs}:${toMs}`); return [{ time: start + 180, long: 7, short: 900_000 }]; } });
    const chart = valid(await chartFor(said(R3, s), s, r, cache()));
    expect(calls).toEqual([`minutes:${(start - 900) * 1000}:${(start + 540 + 960) * 1000}`]);
    expect(chart).toMatchObject({ kind: 'bars_mirror', unit: 'usd', ref: 0, highlight: { from: start, to: start + 540 }, span: { from: start - 900, to: start + 540 + 900 } });
    expect(keys(chart)).toEqual(['short', 'long']);
    expect(chart.series[0]?.points).toHaveLength(15 + 10 + 15); // minutes 0…9 of the cascade, 15 either side
    expect(chart.series[0]?.points.find((p) => p.time === start + 180)?.value).toBe(900_000);
    expect(chart.series[1]?.points.find((p) => p.time === start + 180)?.value).toBe(7);
    expect(chart.series[0]?.points.find((p) => p.time === start + 60)?.value).toBe(0);
  });
  it('a second request inside 5 minutes reads nothing', async () => {
    const { r, calls } = reads();
    const k = cache();
    await chartFor(said(R3, s), s, r, k);
    await chartFor(said(R3, s), s, r, k);
    expect(calls).toHaveLength(1);
  });
});

describe('R4 OI vs price: two lines as % from the row\'s own reference, ref 0', () => {
  const r4row = (refSec: number | null) => ({ ...row('SOLUSDT', { oi: c(26, 0.99), price: c(0.1, 0.2) }), quadrant: 'new_longs' as const, priceRefTime: refSec });
  const ref24h = refBarCloseMs('24h', NOW) / 1000; // NOW is 12:02: yesterday's 12:00 close
  it('24h: 5 m klines from the reference bar at EXACTLY 289 (weight 2), OI at 5 m (weight 0); price first, both from 0', async () => {
    const s = snapshot({ positioning: [r4row(ref24h)] });
    const { r, calls } = reads();
    const chart = valid(await chartFor(said(R4, s), s, r, cache()));
    const fromMs = ref24h * 1000 - 300_000; // the bar that CLOSES at the reference
    expect(calls.sort()).toEqual([`klines:SOLUSDT:5m:${fromMs}:289`, 'oi:SOLUSDT:0'].sort());
    expect(chart).toMatchObject({ kind: 'lines', unit: 'pct', ref: 0, band: null, span: { from: ref24h, to: NOW_S } });
    expect(keys(chart)).toEqual(['price', 'oi']);
    // the first point is the reference bar's CLOSE at the reference time (the fake's closes are 51 + i)
    expect(chart.series[0]?.points[0]).toEqual({ time: ref24h, value: 0 });
    expect(chart.series[0]?.points.at(-1)?.value).toBeCloseTo((51 + 288) / 51 * 100 - 100, 6);
    expect(chart.series[1]?.points[0]?.value).toBe(0);
    expect(chart.series[1]?.points.at(-1)?.value).toBeCloseTo((1_000 - 288) / 1_000 * 100 - 100, 6);
  });

  it('ACCEPTANCE (1h): at any moment of an hour, the axis starts within 5 min of −60 min', async () => {
    const t0 = Date.UTC(2026, 10, 5, 12);
    for (let at = t0; at < t0 + 3_600_000; at += 37_000) {
      const s = snapshot({ nowMs: at, period: '1h', positioning: [r4row(refBarCloseMs('1h', at) / 1000)] });
      const st = { ...said(R4, { ...s, period: '24h' }), basis: { ...said(R4, { ...s, period: '24h' }).basis, window: '1h' as const } };
      const chart = valid(await chartFor(st, s, reads().r, new TtlCache({ now: () => at })));
      const back = Math.floor(at / 1000) - chart.span.from;
      expect(back).toBeGreaterThanOrEqual(3_600);
      expect(back).toBeLessThanOrEqual(3_600 + 300);
      expect(chart.series[0]?.points[0]?.time).toBe(refBarCloseMs('1h', at) / 1000);
    }
  });

  it('ONE reference: the chart starts at the ROW\'s priceRefTime, not one recomputed from the snapshot\'s clock', async () => {
    // the row was built at 11:57 (its own 60 s cache): its 24h reference is yesterday's 11:55, though the snapshot's clock says 12:00
    const rowRef = ref24h - 300;
    const s = snapshot({ positioning: [r4row(rowRef)] });
    const { r, calls } = reads();
    const chart = valid(await chartFor(said(R4, s), s, r, cache()));
    expect(chart.series[0]?.points[0]?.time).toBe(rowRef);
    expect(chart.span.from).toBe(rowRef);
    expect(calls).toContain(`klines:SOLUSDT:5m:${rowRef * 1000 - 300_000}:290`);
  });

  it('the window: the reference bar to the last CLOSED bar — 12–13 / 48–49 / 288–289 bars, weight 1 / 1 / 2', () => {
    for (const at of [NOW, NOW + 38 * 60_000, Date.UTC(2026, 10, 5, 12, 59, 59)]) {
      for (const p of ['1h', '4h', '24h'] as const) {
        const w = r4Window(p, refBarCloseMs(p, at) / 1000, at).bars as { fromMs: number; limit: number };
        const lastClose = w.fromMs + w.limit * 300_000;
        expect(lastClose).toBeLessThanOrEqual(at);
        expect(lastClose + 300_000).toBeGreaterThan(at);
        const n = { '1h': 12, '4h': 48, '24h': 288 }[p];
        expect([n, n + 1]).toContain(w.limit);
      }
    }
  });

  it('r4PriceLine: each bar\'s close at its END — the first point is the reference close, never the next bar\'s open', () => {
    expect(r4PriceLine([{ time: 1_000, close: 7 }, { time: 1_300, close: 8 }])).toEqual([{ time: 1_300, value: 7 }, { time: 1_600, value: 8 }]);
  });

  it('a price line not starting at the reference (the venue skipped that bar) is no chart: it would not match the title', async () => {
    const s = snapshot({ positioning: [r4row(ref24h)] });
    const { r } = reads({ closedKlines: async (_c, _tf, fromMs, limit) => ramp(limit - 1, 1).map((i) => ({ time: fromMs / 1000 + i * 300, open: 1, high: 1, low: 1, close: 1 })) });
    expect(await chartFor(said(R4, s), s, r, cache())).toBeNull();
  });

  it('a row with no reference reads nothing and draws nothing', async () => {
    const s = snapshot({ positioning: [r4row(null)] });
    const { r, calls } = reads();
    expect(await chartFor(said(R4, s), s, r, cache())).toBeNull();
    expect(calls).toEqual([]);
  });

  it('7d: the baseline\'s hourly closes from the row\'s reference (no klines) and OI at ≥ 1 h', async () => {
    const ref7d = Date.UTC(2026, 9, 29, 12) / 1000; // the last whole hour ≤ now − 7 d: 2026-10-29 12:00
    const s = snapshot({ period: '7d', positioning: [r4row(ref7d)] });
    const { r, calls } = reads();
    const st = { ...said(R4, { ...s, period: '24h' }), basis: { ...said(R4, { ...s, period: '24h' }).basis, window: '7d' as const } };
    const chart = valid(await chartFor(st, s, r, cache()));
    expect(calls.some((x) => x.startsWith('klines'))).toBe(false);
    expect(calls).toContain('oi:SOLUSDT:3600000');
    expect(calls).toContain(`closes:SOLUSDT:${ref7d * 1000}`);
    expect(chart.series[0]?.points[0]?.time).toBe(ref7d);
  });

  it('a second request for the same (coin, period, reference) inside 5 minutes reads nothing; a new reference reads again', async () => {
    const { r, calls } = reads();
    const k = cache();
    const s = snapshot({ positioning: [r4row(ref24h)] });
    await chartFor(said(R4, s), s, r, k);
    await chartFor(said(R4, s), s, r, k);
    expect(calls).toHaveLength(2);
    const moved = snapshot({ positioning: [r4row(ref24h + 300)] });
    await chartFor(said(R4, moved), moved, r, k);
    expect(calls).toHaveLength(4);
  });
});

describe('R5 funding: every settlement for 30 days around 0, the band = the rarity\'s own sample', () => {
  const settled = ramp(90, 0).map((i) => ({ time: NOW_S - (90 - i) * 28_800, rate: 0.0001 + ((i * 7) % 11 - 5) * 0.00001 }));
  const s = snapshot({ positioning: [row('TRUMPUSDT', { funding: c(-0.000332, 0.99, 90) }), row('C', {})] });
  const fake = reads({ fundingSettlements: async () => new Map([['TRUMPUSDT', settled], ['C', settled.map((p) => ({ ...p, rate: 0.5 }))]]) });

  it('bars in % (rate × 100) with the CURRENT rate last, at now, lit; ref 0', async () => {
    const chart = valid(await chartFor(said(R5, s), s, fake.r, cache()));
    expect(chart).toMatchObject({ kind: 'bars', unit: 'pct', ref: 0, highlight: { from: NOW_S, to: NOW_S } });
    expect(keys(chart)).toEqual(['funding']);
    const pts = chart.series[0]!.points;
    expect(pts).toHaveLength(91);
    expect(pts.slice(0, 90).map((p) => p.value)).toEqual(settled.map((p) => p.rate * 100));
    expect(pts[90]).toEqual({ time: NOW_S, value: -0.0332 });
  });

  it('the band is the SAME sample as the rarity: a bar outside it ⇔ levelRarity ≥ 0.90', async () => {
    const chart = valid(await chartFor(said(R5, s), s, fake.r, cache()));
    const band = chart.band as { lo: number; hi: number };
    const rates = settled.map((p) => p.rate);
    const edge = levelBand(rates, 0.9) as { lo: number; hi: number };
    expect(band.lo).toBeCloseTo(edge.lo * 100, 12);
    expect(band.hi).toBeCloseTo(edge.hi * 100, 12);
    // every probe off the band's exact edges: outside the band (amber on the card) is exactly "rare"
    for (const v of [...ramp(81, -0.0004, 0.00001), -0.000332, 0.002]) {
      const pct = v * 100;
      if (Math.abs(pct - band.lo) < 1e-12 || Math.abs(pct - band.hi) < 1e-12) continue;
      const outside = pct < band.lo || pct > band.hi;
      expect([v, outside]).toEqual([v, (levelRarity(v, rates) as number) >= 0.9]);
    }
  });

  it('no settlements held for the coin → no chart, the statement still speaks', async () => {
    expect(await chartFor(said(R5, s), s, reads().r, cache())).toBeNull();
  });
});

describe('R6 crowd vs top traders: account L/S and top-trader L/S, ref 1.0', () => {
  it('two lines, accounts first', async () => {
    const s = snapshot({ positioning: [row('ETHUSDT', { lsG: c(2.6, 0.95, 720), lsT: c(0.7, 0.92, 720) })] });
    const { r, calls } = reads();
    const chart = valid(await chartFor(said(R6, s), s, r, cache()));
    expect(chart).toMatchObject({ kind: 'lines', unit: 'ratio', ref: 1, band: null });
    expect(keys(chart)).toEqual(['ls_global', 'ls_top']);
    expect(chart.series[0]?.points[0]?.value).toBe(2);
    expect(chart.series[1]?.points[0]?.value).toBe(0.8);
    expect(calls.sort()).toEqual(['ls:ETHUSDT:global_account', 'ls:ETHUSDT:top_position']);
  });
});

describe('R7 breadth: the share of coins up, last 24 h hourly + now, ref 50 %', () => {
  it('in percent, stamped back from the last hour', async () => {
    const s = snapshot({ fng: 20 });
    const chart = valid(await chartFor(said(R7, s), s, null, cache()));
    expect(chart).toMatchObject({ kind: 'lines', unit: 'share', ref: 50 });
    expect(keys(chart)).toEqual(['up_share']);
    const pts = chart.series[0]!.points;
    expect(pts).toHaveLength(25);
    expect(pts.at(-1)).toEqual({ time: NOW_S - 120, value: 5 });
    expect(pts[0]?.time).toBe(NOW_S - 120 - 24 * 3_600);
    expect(pts.slice(0, -1).map((p) => p.value)).toEqual(snapshot().breadth!.upShareSample.slice(-24).map((x) => x * 100));
  });
});

describe('R8 / R9 / R10: the flows payload\'s own series', () => {
  const flows = (over: Partial<WebFlowsResponse>): WebFlowsResponse => ({ ...flowsExample, ...over });
  it('R8: DVOL as a line in index points, no invented reference', async () => {
    const s = snapshot({ flows: flows({ dvol: { ...flowsExample.dvol, change: ch(6.5, 0.97) } }) });
    const chart = valid(await chartFor(said(R8, s), s, null, cache()));
    expect(chart).toMatchObject({ kind: 'lines', unit: 'index', ref: null });
    expect(chart.series[0]?.points.map((p) => p.value)).toEqual(flowsExample.dvol.series.map((p) => p.value));
  });
  it('R9: the last 30 days of supply in USD', async () => {
    const s = snapshot({ flows: flows({ stablecoins: { ...flowsExample.stablecoins, changeUsd: ch(-4e9, 0.98), changePct: -1.4, changeDays: 1 } }) });
    const chart = valid(await chartFor(said(R9, s), s, null, cache()));
    expect(chart).toMatchObject({ kind: 'lines', unit: 'usd', ref: null });
    expect(keys(chart)).toEqual(['stablecoins']);
    expect(chart.series[0]?.points.map((p) => p.value)).toEqual(flowsExample.stablecoins.series.slice(-31).map((p) => p.value));
  });
  it('R10: the last 60 one-minute premiums as bars around 0', async () => {
    const t0 = 1_793_758_000;
    const minutes = Array.from({ length: 75 }, (_, i) => ({ time: t0 + i * 60, value: i < 15 ? 9 : -(i - 15) }));
    const s = snapshot({ flows: flows({ coinbasePremium: { ...flowsExample.coinbasePremium, premiumPct: ch(-0.18, 0.96), minutes: 60, sameSignMinutes: 58, unavailable: null, series: minutes } }) });
    const chart = valid(await chartFor(said(R10, s), s, null, cache()));
    expect(chart).toMatchObject({ kind: 'bars', unit: 'pct', ref: 0 });
    expect(keys(chart)).toEqual(['premium']);
    expect(chart.series[0]?.points.map((p) => p.value + 0)).toEqual(ramp(60, 0, -1)); // + 0: the first minute is −0
  });
});

describe('R11 OI divergence: price and OI (contracts) as % from A − 2 bars, ref 0, A and B marked', () => {
  const alert = {
    id: 9, source: 'live' as const, symbol: 'BTCUSDT', tf: '1h' as const, direction: 'bullish' as const,
    a: { time: Math.floor(NOW_S / 3_600) * 3_600 - 30 * 3_600, price: 40, oiTime: 0, oi: 1_000 },
    b: { time: Math.floor(NOW_S / 3_600) * 3_600 - 8 * 3_600, price: 38, oiTime: 0, oi: 1_032 },
    runOf: null, runLength: 2, params: { perTf: { '15m': { n: 6, k: 3, w: 96 }, '1h': { n: 6, k: 3, w: 168 }, '4h': { n: 6, k: 3, w: 90 } }, atrMult: 0.25, oiMedianMult: 0.5, priceLineTolAtrMult: 0.25, oiLineTolMedianMult: 0.5 },
    confirmedAt: NOW_S - 3_600, firedAt: null, late: false, recipients: 0, priceAtFire: null, price4h: null, price24h: null, outcomeAt: null,
  };
  it('one klines call at exactly A − 2 … B + N (weight ≤ 2), the detector\'s series (lows and per-bar MIN OI for bullish)', async () => {
    const s = snapshot({ oiDivergence: { alert } });
    const readings = ramp(31 * 12, 0).map((i) => ({ time: alert.a.time - 2 * 3_600 + (i + 1) * 300, oi: 2_000 + (i % 12) }));
    const { r, calls } = reads({ oiReadings: async () => readings });
    const chart = valid(await chartFor(said(R11, s), s, r, cache()));
    const bars = r11Bars(alert, NOW) as { fromMs: number; limit: number };
    expect(bars).toMatchObject({ fromMs: (alert.a.time - 2 * 3_600) * 1000, limit: 2 + 22 + 6 + 1 });
    expect(calls).toEqual([`klines:BTCUSDT:1h:${bars.fromMs}:31`]);
    expect(chart).toMatchObject({ kind: 'lines', unit: 'pct', ref: 0, marks: [alert.a.time, alert.b.time], highlight: { from: alert.a.time, to: alert.b.time } });
    expect(keys(chart)).toEqual(['price', 'oi']);
    expect(chart.series[0]?.points[1]?.value).toBeCloseTo((41 / 40 - 1) * 100, 9); // lows: 40, 41, …
    expect(chart.series[1]?.points.every((p) => p.value === 0)).toBe(true); // per-bar MIN is 2 000 in every bar
  });
  it('B + N is capped at the last closed bar', () => {
    const late = { ...alert, b: { ...alert.b, time: Math.floor(NOW_S / 3_600) * 3_600 - 2 * 3_600 } };
    const bars = r11Bars(late, NOW) as { fromMs: number; limit: number };
    expect(bars.fromMs / 1000 + (bars.limit - 1) * 3_600).toBe(Math.floor(NOW_S / 3_600) * 3_600 - 3_600);
  });
  it('the limit stays under 500 (weight 2) for the widest window W + N + 3 on 1h', () => {
    const wide = { ...alert, a: { ...alert.a, time: alert.b.time - 168 * 3_600 } };
    expect(r11Bars(wide, NOW + 10 * 86_400_000)?.limit).toBe(168 + 6 + 3);
  });
});

describe('the 300-point limit and the shared helpers', () => {
  it('a long line is thinned to 300 with both ends kept; the schema refuses 301', () => {
    const pts = ramp(2_016, 0).map((i) => ({ time: i, value: i }));
    const t = thin(pts);
    expect(t).toHaveLength(WEB_INSIGHT_CHART_MAX_POINTS);
    expect([t[0], t.at(-1)]).toEqual([pts[0], pts.at(-1)]);
  });
  it('R6 over 7 days (672 points at 15 m) arrives as ≤ 300 points', async () => {
    const s = snapshot({ period: '7d', positioning: [row('ETHUSDT', { lsG: c(2.6, 0.95, 720), lsT: c(0.7, 0.92, 720) })] });
    const st = said(R6, { ...s, period: '24h' });
    const { r } = reads({ longShort: async () => ramp(672, 0).map((i) => ({ time: NOW_S - (671 - i) * 900, ratio: 1 + i / 1000 })) });
    const chart = valid(await chartFor(st, s, r, cache()));
    expect(chart.series.every((x) => x.points.length === 300)).toBe(true);
  });
  it('pctFromFirst refuses a non-positive base (a change from zero is not a percentage)', () => {
    expect(pctFromFirst([{ time: 0, value: 0 }, { time: 1, value: 3 }])).toBeNull();
  });
});

describe('only displayed statements get a chart (after ranking); a failed read is that card\'s null', () => {
  const r4row = { ...row('SOLUSDT', { oi: c(26, 0.99), price: c(0.1, 0.2) }), quadrant: 'new_longs' as const, priceRefTime: refBarCloseMs('24h', NOW) / 1000 };

  it('a statement in the top AND its block is built once; the response parses', async () => {
    const s = snapshot({ positioning: [r4row] });
    const { r, calls } = reads();
    const out = await attachCharts(runInsights(RULES, s), s, r, cache());
    expect(calls.filter((x) => x.startsWith('klines'))).toHaveLength(1);
    const top = out.top.find((x) => x.ruleId === 'R4');
    expect(top?.chart?.kind).toBe('lines');
    expect(out.blocks.find((b) => b.block === 'positioning')?.statement?.chart).toEqual(top?.chart);
    expect(WebInsightsResponseSchema.safeParse({ ...out, asOf: NOW_S }).success).toBe(true);
  });

  it('a candidate that is NOT shown is never read for', async () => {
    const rows = [r4row, ...ramp(6, 0).map((i) => ({ ...row(`C${i}USDT`, { oi: c(20 - i, 0.95, 696), price: c(0.1, 0.2) }), quadrant: 'new_longs' as const }))];
    const s = snapshot({ positioning: rows });
    const { r, calls } = reads();
    await attachCharts(runInsights(RULES, s), s, r, cache());
    // R4 names ONE coin (its best); the six other R4 candidates are never charted
    expect(calls.filter((x) => x.startsWith('klines')).map((x) => x.split(':')[1])).toEqual(['SOLUSDT']);
  });

  it('a read that throws leaves that card\'s chart null and the rest of the response intact', async () => {
    const s = snapshot({ positioning: [r4row], liquidations: { ...snapshot().liquidations!, short: { usd: 5_000, sample: days(30) } } });
    const errors: string[] = [];
    const { r } = reads({ closedKlines: async () => { throw new Error('418'); } });
    const out = await attachCharts(runInsights(RULES, s), s, r, cache(), (rule) => errors.push(rule));
    expect(out.top.find((x) => x.ruleId === 'R4')?.chart).toBeNull();
    expect(out.top.find((x) => x.ruleId === 'R1')?.chart?.kind).toBe('bars_mirror');
    expect(errors).toEqual(['R4']);
  });

  it('no reads wired: the zero-cost charts still draw, the read-backed ones are null', async () => {
    const s = snapshot({ positioning: [r4row], liquidations: { ...snapshot().liquidations!, short: { usd: 5_000, sample: days(30) } } });
    const out = await attachCharts(runInsights(RULES, s), s, null, cache());
    expect(out.top.find((x) => x.ruleId === 'R1')?.chart).not.toBeNull();
    expect(out.top.find((x) => x.ruleId === 'R4')?.chart).toBeNull();
  });
});

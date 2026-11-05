import {
  OI_DIVERGENCE_TF_SEC, WEB_MARKET_PERIOD_SECONDS, type WebInsightChart, type WebInsightChartPoint, type WebInsightStatement,
  type WebMarketPeriod, type WebOiDivergenceAlert,
} from '@trade-automation/contracts';
import { oiPerBar, type OiPoint } from '../divergence/oi-per-bar';
import { RARITY_SHOW } from '../thresholds';
import type { InsightSnapshot } from '../types';
import { chartOf, levelBand, pctFromFirst, tail, upperBand } from './chart-math';

/**
 * IB-119 (market round 2 §3, the per-rule table) — one chart per rule, PURE: each takes the statement,
 * the snapshot the rule read, and (R3, R4, R6, R11) the series `insight-charts.ts` fetched for it.
 * What each draws, and its reference line:
 *
 * | rule | kind | series | ref | band | highlight |
 * |---|---|---|---|---|---|
 * | R1 | bars_mirror | shorts above, longs below, the period's bars | 0 | — | the current bar |
 * | R2 | bars | the coin's last ≤ 14 windows + the current one | 0 | the sample's normal (one-sided) | now |
 * | R3 | bars_mirror | 1-minute USD of both sides, ±15 min round the cascade | 0 | — | the cascade's minutes |
 * | R4 | lines | price and OI, % from the period start | 0 | — | — |
 * | R5 | bars | every settlement for 30 days + the current rate | 0 | the rarity's own sample | now |
 * | R6 | lines | crowd (accounts) and top-trader L/S over the period | 1 | — | — |
 * | R7 | lines | share of coins up, last 24 h hourly + now | 50 | — | now |
 * | R8 | lines | DVOL | — | — | now |
 * | R9 | lines | stablecoin supply, 30 days | — | — | now |
 * | R10 | bars | Coinbase premium, the last 60 minutes | 0 | — | — |
 * | R11 | lines | price and OI (contracts), % from A − 2 bars | 0 | — | A … B, marks A and B |
 */

const SEC = (ms: number) => Math.floor(ms / 1000);
const now = (s: InsightSnapshot) => SEC(s.nowMs);
/** R2: the coin's last windows, as IB-107's spark did (§3: "the last ≤ 14 windows plus the current one"). */
export const R2_WINDOWS = 14;
/** R3: minutes before the cascade's first event and after its last. */
export const R3_PAD_MIN = 15;
export const R7_HOURS = 24;
export const R9_DAYS = 30;
export const R10_MINUTES = 60;
/** R11: bars before A, and the alert's own N after B (capped at the last closed bar). */
export const R11_BARS_BEFORE_A = 2;
/** R4 below 7d: 5 m price bars at exactly the period's count (12 / 48 / 288 → weight 1 / 1 / 2). */
export const R4_BAR_SEC = 300;

const symbolOf = (st: WebInsightStatement) => (typeof st.params['symbol'] === 'string' ? st.params['symbol'] : null);

export function r1Chart(s: InsightSnapshot): WebInsightChart | null {
  const bars = s.liquidations?.bars ?? [];
  const last = bars[bars.length - 1];
  if (!last || bars.length < 2) return null;
  return chartOf({
    kind: 'bars_mirror', unit: 'usd', ref: 0, band: null,
    series: [
      { key: 'short', points: bars.map((b) => ({ time: b.time, value: b.short })) },
      { key: 'long', points: bars.map((b) => ({ time: b.time, value: b.long })) },
    ],
    highlight: { from: last.time, to: last.time }, marks: [], span: { from: (bars[0] as { time: number }).time, to: now(s) },
  });
}

/**
 * R2: the windows are complete and epoch-aligned, contiguous up to the last one that has closed
 * (`completeWindowStarts`), so the k-th from the end ENDS at `floor(now / P) · P − k · P`. Each bar is
 * stamped with its window's end; the current one (trailing P) with now.
 */
export function r2Chart(st: WebInsightStatement, s: InsightSnapshot): WebInsightChart | null {
  const symbol = symbolOf(st);
  const coin = symbol === null ? undefined : s.liquidations?.coins.get(symbol);
  if (!coin) return null;
  const p = WEB_MARKET_PERIOD_SECONDS[s.period];
  const lastEnd = Math.floor(now(s) / p) * p;
  const past = tail(coin.sample, R2_WINDOWS);
  const points = [...past.map((v, i) => ({ time: lastEnd - (past.length - 1 - i) * p, value: v })), { time: now(s), value: coin.usd }];
  return chartOf({
    kind: 'bars', unit: 'usd', ref: 0, band: upperBand(coin.sample, RARITY_SHOW),
    series: [{ key: 'usd', points }], highlight: { from: now(s), to: now(s) }, marks: [],
    span: { from: (points[0] as WebInsightChartPoint).time - p, to: now(s) },
  });
}

/** R3: the cascade the statement names — its first event is the link's moment; its last, from its series. */
export function r3Window(st: WebInsightStatement, s: InsightSnapshot): { fromMs: number; toMs: number; start: number; end: number } | null {
  if (!('route' in st.link) || st.link.timeSec === null) return null;
  const start = st.link.timeSec;
  const events = (s.liquidations?.large ?? []).filter((e) => e.seriesId !== null);
  const ids = new Set(events.filter((e) => e.time === start).map((e) => e.seriesId));
  const members = events.filter((e) => ids.has(e.seriesId));
  const end = members.length > 0 ? Math.max(...members.map((e) => e.time)) : start;
  const m0 = Math.floor(start / 60) * 60;
  const m1 = Math.floor(end / 60) * 60;
  return { start: m0, end: m1, fromMs: (m0 - R3_PAD_MIN * 60) * 1000, toMs: Math.min(s.nowMs, (m1 + (R3_PAD_MIN + 1) * 60) * 1000) };
}

/** R3: minute sums of both sides, the empty minutes filled with 0 (a quiet minute is a real zero). */
export function r3Chart(win: { fromMs: number; toMs: number; start: number; end: number }, minutes: ReadonlyArray<{ time: number; long: number; short: number }>): WebInsightChart | null {
  const by = new Map(minutes.map((m) => [m.time, m]));
  const grid: number[] = [];
  for (let t = SEC(win.fromMs); t * 1000 < win.toMs; t += 60) grid.push(t);
  if (grid.length < 2) return null;
  const side = (k: 'long' | 'short') => grid.map((t) => ({ time: t, value: by.get(t)?.[k] ?? 0 }));
  return chartOf({
    kind: 'bars_mirror', unit: 'usd', ref: 0, band: null,
    series: [{ key: 'short', points: side('short') }, { key: 'long', points: side('long') }],
    highlight: { from: win.start, to: win.end }, marks: [], span: { from: grid[0] as number, to: grid[grid.length - 1] as number },
  });
}

/** R4 below 7d: exactly the period's 5 m bars, so one klines call at the IB-115 exact limit. */
export function r4Bars(period: WebMarketPeriod, nowMs: number): { fromMs: number; limit: number } | null {
  if (period === '7d') return null;
  const limit = WEB_MARKET_PERIOD_SECONDS[period] / R4_BAR_SEC;
  const lastOpen = Math.floor(nowMs / (R4_BAR_SEC * 1000)) * R4_BAR_SEC * 1000 - R4_BAR_SEC * 1000;
  return { fromMs: lastOpen - (limit - 1) * R4_BAR_SEC * 1000, limit };
}

/** 5 m klines → a price line: the first bar's open, then each close at its bar's end. */
export function klinesToLine(klines: ReadonlyArray<{ time: number; open: number; close: number }>, barSec: number): WebInsightChartPoint[] {
  const first = klines[0];
  if (!first) return [];
  return [{ time: first.time, value: first.open }, ...klines.map((k) => ({ time: k.time + barSec, value: k.close }))];
}

export function r4Chart(s: InsightSnapshot, price: readonly WebInsightChartPoint[], oi: readonly WebInsightChartPoint[]): WebInsightChart | null {
  return chartOf({
    kind: 'lines', unit: 'pct', ref: 0, band: null,
    series: [{ key: 'price', points: pctFromFirst(price) }, { key: 'oi', points: pctFromFirst(oi) }],
    highlight: null, marks: [], span: { from: now(s) - WEB_MARKET_PERIOD_SECONDS[s.period], to: now(s) },
  });
}

/**
 * R5: every settlement of the 30-day baseline, in % (rate × 100), then the CURRENT rate — the figure
 * the card's title prints and the rarity judged — at now, highlighted. The band comes from the SAME
 * settlements the rarity used (`levelRarity(current, fundingSettled)`), so a bar outside it is a rate
 * the rule calls rare.
 */
export function r5Chart(st: WebInsightStatement, s: InsightSnapshot, settlements: ReadonlyArray<{ time: number; rate: number }> | undefined): WebInsightChart | null {
  const rate = st.params['rate'];
  if (!settlements || settlements.length === 0 || typeof rate !== 'number') return null;
  const band = levelBand(settlements.map((p) => p.rate), RARITY_SHOW);
  const points = [...settlements.map((p) => ({ time: p.time, value: p.rate * 100 })), { time: now(s), value: rate * 100 }];
  return chartOf({
    kind: 'bars', unit: 'pct', ref: 0, band: band && { lo: band.lo * 100, hi: band.hi * 100 },
    series: [{ key: 'funding', points }], highlight: { from: now(s), to: now(s) }, marks: [],
    span: { from: (settlements[0] as { time: number }).time, to: now(s) },
  });
}

export function r6Chart(s: InsightSnapshot, global: ReadonlyArray<{ time: number; ratio: number }>, top: ReadonlyArray<{ time: number; ratio: number }>): WebInsightChart | null {
  const line = (xs: ReadonlyArray<{ time: number; ratio: number }>) => xs.map((p) => ({ time: p.time, value: p.ratio }));
  return chartOf({
    kind: 'lines', unit: 'ratio', ref: 1, band: null,
    series: [{ key: 'ls_global', points: line(global) }, { key: 'ls_top', points: line(top) }],
    highlight: null, marks: [], span: { from: now(s) - WEB_MARKET_PERIOD_SECONDS[s.period], to: now(s) },
  });
}

/**
 * R7: the share of coins up, hourly. The sample is `history[0 … n−2]` and "now" is `history[n−1]`, the
 * hour that ended at `lastHourEnd`; the k-th from the end is k hours before it.
 */
export function r7Chart(s: InsightSnapshot): WebInsightChart | null {
  const b = s.breadth;
  if (!b) return null;
  const past = tail(b.upShareSample, R7_HOURS);
  const points = [...past.map((v, i) => ({ time: b.lastHourEnd - (past.length - i) * 3_600, value: v * 100 })), { time: b.lastHourEnd, value: b.upShare * 100 }];
  return chartOf({
    kind: 'lines', unit: 'share', ref: 50, band: null, series: [{ key: 'up_share', points }],
    highlight: { from: b.lastHourEnd, to: b.lastHourEnd }, marks: [], span: { from: (points[0] as WebInsightChartPoint).time, to: b.lastHourEnd },
  });
}

/** R8 / R9 / R10: the flows payload's own series, the tail the rule talks about. */
export function flowsChart(st: WebInsightStatement, s: InsightSnapshot): WebInsightChart | null {
  const f = s.flows;
  if (!f) return null;
  const line = (key: 'dvol' | 'stablecoins', unit: 'index' | 'usd', pts: WebInsightChartPoint[]) => {
    const last = pts[pts.length - 1];
    if (!last || pts.length < 2) return null;
    return chartOf({ kind: 'lines', unit, ref: null, band: null, series: [{ key, points: pts }], highlight: { from: last.time, to: last.time }, marks: [], span: { from: (pts[0] as WebInsightChartPoint).time, to: last.time } });
  };
  if (st.ruleId === 'R8') return line('dvol', 'index', [...f.dvol.series]);
  if (st.ruleId === 'R9') return line('stablecoins', 'usd', tail(f.stablecoins.series, R9_DAYS + 1));
  if (st.ruleId === 'R10') {
    const pts = f.coinbasePremium.series;
    const last = pts[pts.length - 1];
    if (!last) return null;
    const recent = pts.filter((p) => p.time > last.time - R10_MINUTES * 60);
    return chartOf({ kind: 'bars', unit: 'pct', ref: 0, band: null, series: [{ key: 'premium', points: recent }], highlight: null, marks: [], span: { from: last.time - (R10_MINUTES - 1) * 60, to: last.time } });
  }
  return null;
}

/**
 * R11: the bars from A − 2 to B + N (the alert's own N, capped at the last closed bar) — one klines
 * call at exactly that count (W + N + 3 at most → weight ≤ 2).
 */
export function r11Bars(alert: Pick<WebOiDivergenceAlert, 'tf' | 'a' | 'b' | 'params'>, nowMs: number): { fromMs: number; limit: number; tfSec: number } | null {
  const tfSec = OI_DIVERGENCE_TF_SEC[alert.tf];
  const n = alert.params.perTf[alert.tf].n;
  const lastClosedOpen = Math.floor(nowMs / 1000 / tfSec) * tfSec - tfSec;
  const from = alert.a.time - R11_BARS_BEFORE_A * tfSec;
  const to = Math.min(alert.b.time + n * tfSec, lastClosedOpen);
  if (to < alert.b.time) return null;
  return { fromMs: from * 1000, limit: (to - from) / tfSec + 1, tfSec };
}

/**
 * R11: per bar the series the detector judged (V4) — the LOW and the per-bar MIN of OI for a bullish
 * divergence, the HIGH and the MAX for a bearish one — each as % from the first bar, so A and B sit
 * where the alert measured them. A bar without an OI reading is dropped from the OI line, not drawn as 0.
 */
export function r11Chart(
  alert: Pick<WebOiDivergenceAlert, 'tf' | 'direction' | 'a' | 'b'>,
  klines: ReadonlyArray<{ time: number; high: number; low: number }>, readings: readonly OiPoint[],
): WebInsightChart | null {
  if (klines.length < 2) return null;
  const tfSec = OI_DIVERGENCE_TF_SEC[alert.tf];
  const bull = alert.direction === 'bullish';
  const opens = klines.map((k) => k.time);
  const perBar = oiPerBar(opens, readings, tfSec);
  const oiVals = bull ? perBar.min : perBar.max;
  const price = klines.map((k) => ({ time: k.time, value: bull ? k.low : k.high }));
  const oi = opens.flatMap((t, i) => (oiVals[i] === null || oiVals[i] === undefined ? [] : [{ time: t, value: oiVals[i] as number }]));
  return chartOf({
    kind: 'lines', unit: 'pct', ref: 0, band: null,
    series: [{ key: 'price', points: pctFromFirst(price) }, { key: 'oi', points: pctFromFirst(oi) }],
    highlight: { from: alert.a.time, to: alert.b.time }, marks: [alert.a.time, alert.b.time],
    span: { from: opens[0] as number, to: opens[opens.length - 1] as number },
  });
}

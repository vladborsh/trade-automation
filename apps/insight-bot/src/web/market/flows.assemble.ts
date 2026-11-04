import {
  WEB_MARKET_PERIOD_SECONDS, type WebFlowsChange, type WebFlowsPoint, type WebFlowsResponse, type WebMarketPeriod,
} from '@trade-automation/contracts';
import { changeRarity, levelRarity, rarity } from '../../insights/rarity';
import {
  FLOWS_MIN_HISTORY_DAYS, PREMIUM_SUSTAINED_MIN, PREMIUM_WINDOW_MIN, STABLECOIN_SAMPLE_DAYS,
} from '../../insights/thresholds';
import type { PutCallDay, TimedValue } from '../../venues/flows/parse';

/**
 * IB-091 — the four tiles of «Деривативы и потоки», as pure functions over already-parsed
 * series (each with its spec). The service fetches and caches; nothing here sees a network.
 */
const H = 3_600;
const D = 86_400;
const point = (p: TimedValue): WebFlowsPoint => ({ time: p.timeSec, value: p.value });
const spanDays = (s: readonly TimedValue[]) => (s.length < 2 ? 0 : ((s.at(-1) as TimedValue).timeSec - (s[0] as TimedValue).timeSec) / D);

/** The value at or before `timeSec` (the series is oldest first); null when the series starts later. */
export function valueAt(series: readonly TimedValue[], timeSec: number): number | null {
  let found: number | null = null;
  for (const p of series) {
    if (p.timeSec > timeSec) break;
    found = p.value;
  }
  return found;
}

/** Every change over `steps` points, in the series' own units (points of DVOL, USD of supply). */
export function changes(series: readonly TimedValue[], steps: number): number[] {
  const out: number[] = [];
  for (let i = steps; i < series.length; i++) out.push((series[i] as TimedValue).value - (series[i - steps] as TimedValue).value);
  return out;
}

/** A change and its D2 rarity; rarity null under the D3 minimum (the value still stands). */
function change(value: number, sample: number[], days: number, rarityOf: (v: number, s: number[]) => number | null): WebFlowsChange {
  return { value, rarity: days >= FLOWS_MIN_HISTORY_DAYS ? rarityOf(value, sample) : null, sample: sample.length, sampleDays: days };
}

/**
 * DVOL tile (R8). Now = the latest hourly close; the change over the period is measured on the
 * hourly series. Its sample: same-length changes in the source's own history — hourly ones for
 * 1h/4h, daily ones for 24h/7d. SIGNED rarity (a spike is a rise, R8 is rise-only).
 * The mini-chart is the last 7 days hourly.
 */
export function dvolTile(hourly: readonly TimedValue[], daily: readonly TimedValue[], period: WebMarketPeriod): Pick<WebFlowsResponse['dvol'], 'value' | 'change' | 'series'> {
  const last = hourly.at(-1);
  if (!last) return { value: null, change: null, series: [] };
  const sec = WEB_MARKET_PERIOD_SECONDS[period];
  const before = valueAt(hourly, last.timeSec - sec);
  const byHour = sec < D;
  const sample = byHour ? changes(hourly, sec / H) : changes(daily, sec / D);
  const days = spanDays(byHour ? hourly : daily);
  return {
    value: last.value,
    change: before === null ? null : change(last.value - before, sample, days, rarity),
    series: hourly.filter((p) => p.timeSec >= last.timeSec - 7 * D).map(point),
  };
}

/** Put/call tile: the latest day's ratios and the OI-ratio series (no rule reads it — the cut). */
export function putCallTile(days: readonly PutCallDay[]): Pick<WebFlowsResponse['putCall'], 'oiRatio' | 'volumeRatio' | 'asOf' | 'series'> {
  const last = days.at(-1);
  return {
    oiRatio: last?.oiRatio ?? null,
    volumeRatio: last?.volumeRatio ?? null,
    asOf: last?.timeSec ?? null,
    series: days.map((d) => ({ time: d.timeSec, value: d.oiRatio })),
  };
}

/**
 * Stablecoin tile (R9): total supply now and its change over 1 day — 7 days on the 7d page — with
 * a TWO-SIDED rarity (a mint or a burn) against the same-length changes of the last year.
 */
export function stablecoinTile(daily: readonly TimedValue[], period: WebMarketPeriod): Pick<WebFlowsResponse['stablecoins'], 'supplyUsd' | 'changeDays' | 'changeUsd' | 'changePct' | 'series'> {
  const changeDays = period === '7d' ? 7 : 1;
  const last = daily.at(-1);
  const base = daily.at(-1 - changeDays);
  if (!last) return { supplyUsd: null, changeDays, changeUsd: null, changePct: null, series: [] };
  const year = daily.filter((p) => p.timeSec >= last.timeSec - STABLECOIN_SAMPLE_DAYS * D);
  const past = changes(year, changeDays).slice(0, -1); // the current change is not its own reference
  return {
    supplyUsd: last.value,
    changeDays,
    changeUsd: base ? change(last.value - base.value, past, spanDays(year), changeRarity) : null,
    changePct: base && base.value > 0 ? (last.value / base.value - 1) * 100 : null,
    series: daily.slice(-90).map(point),
  };
}

/**
 * Coinbase premium tile (R10, D18). `minutes` = the D18 premium per VALID minute (all three closes);
 * the window is the last PREMIUM_WINDOW_MIN minutes. The mean of the valid ones is the figure, its
 * TWO-SIDED level rarity is against the hourly premiums (same formula, three 1h series). Fewer than
 * PREMIUM_SUSTAINED_MIN valid minutes: the value stands WITH `insufficient_minutes`, never a sign.
 */
export function premiumTile(minutes: readonly TimedValue[], hourly: readonly TimedValue[], nowSec: number): Pick<WebFlowsResponse['coinbasePremium'], 'premiumPct' | 'sameSignMinutes' | 'minutes' | 'series' | 'unavailable'> {
  const window = minutes.filter((p) => p.timeSec > nowSec - PREMIUM_WINDOW_MIN * 60 && p.timeSec <= nowSec);
  if (window.length === 0) return { premiumPct: null, sameSignMinutes: 0, minutes: 0, series: [], unavailable: 'source_unavailable' };
  const mean = window.reduce((s, p) => s + p.value, 0) / window.length;
  const sameSign = window.filter((p) => Math.sign(p.value) === Math.sign(mean) && mean !== 0).length;
  return {
    premiumPct: change(mean, hourly.map((p) => p.value), spanDays(hourly), levelRarity),
    sameSignMinutes: sameSign,
    minutes: window.length,
    series: window.map(point),
    unavailable: window.length < PREMIUM_SUSTAINED_MIN ? 'insufficient_minutes' : null,
  };
}

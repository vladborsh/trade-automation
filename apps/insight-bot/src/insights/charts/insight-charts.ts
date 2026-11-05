import { WEB_MARKET_PERIOD_SECONDS, type WebInsightChart, type WebInsightChartPoint, type WebInsightStatement, type WebInsightsResponse } from '@trade-automation/contracts';
import type { OiPoint } from '../divergence/oi-per-bar';
import type { InsightSnapshot } from '../types';
import {
  flowsChart, r1Chart, r2Chart, r3Chart, r3Window, r4Chart, r4PriceLine, r4Window, r5Chart, r6Chart, r7Chart, r11Bars, r11Chart,
} from './rule-charts';

/**
 * IB-119 (market round 2 §3) — the charts are built AFTER ranking, and only for the statements the
 * page shows (the top and the block lines; a statement in both is built once). That bounds every read
 * below by what is on screen, never by the candidates.
 *
 * | rule | read | cost | cached |
 * |---|---|---|---|
 * | R1 R2 R7 R8 R9 R10 | the snapshot the rule read | 0 | with the snapshot (60 s) |
 * | R3 | 1-minute sums of our liquidation tape, ±15 min | 0 (DB) | 5 min per cascade |
 * | R4 | from the row's `priceRefTime` (IB-BUG-040): 7d the positioning baseline's hourly closes; below, 5 m klines at exactly 12–13 / 48–49 / 288–289, one more when the row is a bar older than the snapshot (weight 1 / 1 / 2). OI: `/futures/data` (weight 0) | ≤ 2 per (coin, period) | 5 min per (coin, period, reference) |
 * | R5 | the positioning baseline's 30-day settlements (IB-118) | 0 | the baseline's hour |
 * | R6 | `/futures/data` L/S ×2 (weight 0) | 0 | 5 min per (coin, period) |
 * | R11 | klines on the alert's TF at exactly A − 2 … B + N (≤ W + N + 3 → weight ≤ 2); OI from our DB | ≤ 2 per alert | 1 h per alert id |
 *
 * A chart whose read fails is null on that card (the statement still shows); it is not cached, so the
 * next request tries again.
 */
export interface ChartReads {
  /** IB-118: per coin id, `{time (s), rate}` of the 30-day baseline — the sample R5's rarity used. */
  fundingSettlements(): Promise<ReadonlyMap<string, ReadonlyArray<{ time: number; rate: number }>>>;
  /** The positioning baseline's hourly closes since `fromMs`, `{time: close time (s), value}`. */
  hourlyCloses(coin: string, fromMs: number): Promise<WebInsightChartPoint[]>;
  /** IB-115's exact-limit read: `limit` CLOSED perp klines from `fromMs`, one request. */
  closedKlines(coin: string, tf: '1m' | '5m' | '15m' | '1h' | '4h', fromMs: number, limit: number): Promise<Array<{ time: number; open: number; high: number; low: number; close: number }>>;
  /** OI in contracts (`/futures/data`, weight 0) at the finest grain ≥ `minPeriodMs`. */
  openInterest(coin: string, fromMs: number, toMs: number, minPeriodMs: number): Promise<WebInsightChartPoint[]>;
  longShort(coin: string, kind: 'global_account' | 'top_position', fromMs: number, toMs: number): Promise<Array<{ time: number; ratio: number }>>;
  /** Market-wide CRYPTO liquidation USD per minute and side over [fromMs, toMs); empty minutes absent. */
  liquidationMinutes(fromMs: number, toMs: number): Promise<Array<{ time: number; long: number; short: number }>>;
  /** Our stored 5 m OI readings (contracts) in (fromSec, toSec]. */
  oiReadings(coin: string, fromSec: number, toSec: number): Promise<OiPoint[]>;
}

export interface ChartCache {
  getOrLoad<V>(key: string, ttlMs: number, load: () => Promise<V>): Promise<V>;
}

export const CHART_CACHE_MS = 5 * 60_000;
export const R11_CHART_CACHE_MS = 60 * 60_000;
const H = 3_600_000;

/** Every displayed statement with its chart; the same statement object in the top and a block shares one chart. */
export async function attachCharts(
  result: Omit<WebInsightsResponse, 'asOf'>, s: InsightSnapshot, reads: ChartReads | null, cache: ChartCache,
  onError: (rule: string, error: Error) => void = () => undefined,
): Promise<Omit<WebInsightsResponse, 'asOf'>> {
  const shown = new Map<WebInsightStatement, Promise<WebInsightChart | null>>();
  const want = (st: WebInsightStatement | null) => {
    if (st && !shown.has(st)) {
      shown.set(st, chartFor(st, s, reads, cache).catch((error: unknown) => {
        onError(st.ruleId, error as Error);
        return null;
      }));
    }
  };
  result.top.forEach(want);
  result.blocks.forEach((b) => want(b.statement));
  const charts = new Map<WebInsightStatement, WebInsightChart | null>();
  await Promise.all([...shown.entries()].map(async ([st, p]) => charts.set(st, await p)));
  const withChart = (st: WebInsightStatement): WebInsightStatement => ({ ...st, chart: charts.get(st) ?? null });
  return {
    ...result,
    top: result.top.map(withChart),
    blocks: result.blocks.map((b) => (b.statement ? { ...b, statement: withChart(b.statement) } : b)),
  };
}

export async function chartFor(st: WebInsightStatement, s: InsightSnapshot, reads: ChartReads | null, cache: ChartCache): Promise<WebInsightChart | null> {
  const coin = typeof st.params['symbol'] === 'string' ? st.params['symbol'] : null;
  switch (st.ruleId) {
    case 'R1': return r1Chart(s);
    case 'R2': return r2Chart(st, s);
    case 'R7': return r7Chart(s);
    case 'R8': case 'R9': case 'R10': return flowsChart(st, s);
    case 'R5': {
      if (!reads || coin === null) return null;
      return r5Chart(st, s, (await reads.fundingSettlements()).get(coin));
    }
    case 'R3': {
      const win = r3Window(st, s);
      if (!reads || !win) return null;
      const minutes = await cache.getOrLoad(`insights:chart:r3:${win.fromMs}:${win.toMs}`, CHART_CACHE_MS, () => reads.liquidationMinutes(win.fromMs, win.toMs));
      return r3Chart(win, minutes);
    }
    case 'R4': {
      // IB-BUG-040: the price line starts at the row's own reference: one reference for title and chart
      const refSec = s.positioning?.find((r) => r.symbol === coin)?.priceRefTime ?? null;
      if (!reads || coin === null || refSec === null) return null;
      // the reference is in the key: a chart cached against the previous one would not match the title
      const data = await cache.getOrLoad(`insights:chart:r4:${coin}:${s.period}:${refSec}`, CHART_CACHE_MS, async () => {
        const fromMs = s.nowMs - WEB_MARKET_PERIOD_SECONDS[s.period] * 1000;
        const { refMs, bars } = r4Window(s.period, refSec, s.nowMs);
        const [price, oi] = await Promise.all([
          bars === null
            ? reads.hourlyCloses(coin, refMs)
            : reads.closedKlines(coin, '5m', bars.fromMs, bars.limit).then(r4PriceLine),
          reads.openInterest(coin, fromMs, s.nowMs, s.period === '7d' ? H : 0),
        ]);
        return { price, oi };
      });
      return r4Chart(s, refSec, data.price, data.oi);
    }
    case 'R6': {
      if (!reads || coin === null) return null;
      const data = await cache.getOrLoad(`insights:chart:r6:${coin}:${s.period}`, CHART_CACHE_MS, async () => {
        const fromMs = s.nowMs - WEB_MARKET_PERIOD_SECONDS[s.period] * 1000;
        const [global, top] = await Promise.all([
          reads.longShort(coin, 'global_account', fromMs, s.nowMs), reads.longShort(coin, 'top_position', fromMs, s.nowMs),
        ]);
        return { global, top };
      });
      return r6Chart(s, data.global, data.top);
    }
    case 'R11': {
      const alert = s.oiDivergence?.alert;
      if (!reads || !alert) return null;
      const bars = r11Bars(alert, s.nowMs);
      if (!bars) return null;
      const data = await cache.getOrLoad(`insights:chart:r11:${alert.id}:${bars.limit}`, R11_CHART_CACHE_MS, async () => {
        const fromSec = bars.fromMs / 1000;
        const [klines, readings] = await Promise.all([
          reads.closedKlines(alert.symbol, alert.tf, bars.fromMs, bars.limit),
          reads.oiReadings(alert.symbol, fromSec, fromSec + bars.limit * bars.tfSec),
        ]);
        return { klines, readings };
      });
      return r11Chart(alert, data.klines, data.readings);
    }
    default: return null;
  }
}

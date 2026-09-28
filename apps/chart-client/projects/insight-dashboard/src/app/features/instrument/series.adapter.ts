import type { MetricPoint } from '@trade-automation/contracts';
import type {
  WebCandle, WebFundingResponse, WebLiquidationBar, WebLongShortResponse,
} from '@trade-automation/contracts';

/**
 * IB-031 — turning `/api/web/series/*` responses into what the charts want
 * (architecture/insight-bot-web-dashboard.md §2, §4).
 *
 * Pure, and in its own file with its own spec, per AGENTS.md: everything here is a data mapping,
 * and mappings are where a chart quietly starts lying. Three rules it exists to enforce:
 *
 * 1. **Open interest is emitted in the `MetricPoint` wire shape** so the backtest SPA's
 *    `MetricSeriesRenderer` draws it **unchanged** — that is why the server serves OI this way.
 *    Reused as is, not copied, not forked.
 * 2. **A gap stays a gap.** Missing minutes are never interpolated and never carried forward:
 *    lightweight-charts simply draws no point, and a flat line across an outage would be an
 *    invention. This matters most on CVD, where carrying a value forward would make a dead feed
 *    look like balanced flow.
 * 3. **Everything is sorted and de-duplicated by time**, because the charting library requires
 *    strictly ascending times and throws on anything else — an error a user would see as a
 *    blank panel.
 */

export interface LineDatum {
  time: number;
  value: number;
}

export interface CandleDatum {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Strictly ascending by time, last value winning a duplicate. */
function ascending<T extends { time: number }>(points: readonly T[]): T[] {
  const byTime = new Map<number, T>();
  for (const p of points) byTime.set(p.time, p);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export function toCandleData(candles: readonly WebCandle[]): CandleDatum[] {
  return ascending(candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
}

export function toVolumeData(candles: readonly WebCandle[]): LineDatum[] {
  return ascending(candles.map((c) => ({ time: c.time, value: c.volume })));
}

/**
 * Open interest as `MetricPoint`s, the shape `MetricSeriesRenderer` already draws.
 *
 * **`MetricPoint.time` is epoch MILLISECONDS**, unlike every other series here. The backtest
 * SPA's `chart-data.adapter` does `Math.floor(point.time / 1000)` on its way to the chart, so a
 * point handed over in seconds is divided again and lands in 1970 — the chart then throws
 * `Value is null` during paint, far from the cause. The `/api/web` wire stays in seconds like
 * the rest of the dashboard; converting here is this file's job.
 *
 * `ohlc` is flat (the reading is a snapshot, not a bar) and `samples` is 1: the renderer uses
 * them for candle styling at coarse timeframes, and claiming a range we did not measure would
 * draw wicks that never existed.
 */
export function toOpenInterestPoints(
  rows: readonly { time: number; value: number; notional: number | null }[],
  instrument: string,
  timeframe: string,
): MetricPoint[] {
  return ascending(rows).map((r) => ({
    metric: 'openInterest' as const,
    instrument,
    timeframe,
    time: r.time * 1000, // seconds on our wire → milliseconds, which is what MetricPoint means
    unit: 'base' as const,
    value: r.value,
    ohlc: { open: r.value, high: r.value, low: r.value, close: r.value },
    ...(r.notional === null ? {} : { notional: r.notional, notionalBasis: 'venue' as const }),
    samples: 1,
  })) as MetricPoint[];
}

/**
 * Cumulative volume delta: the running sum of (taker buy − taker sell) per bar, where taker
 * sell is `volume − takerBuyVolume`, so the delta is `2·takerBuy − volume`.
 *
 * **Bars without `takerBuyVolume` break the series rather than contributing zero.** A null is
 * "we do not know this bar's split", and treating it as balanced flow would drag the CVD line
 * toward flat exactly where the data is worst. The result is therefore a list of *segments*;
 * the renderer draws each one and leaves the hole visible.
 */
export function toCvdSegments(candles: readonly WebCandle[]): LineDatum[][] {
  const segments: LineDatum[][] = [];
  let current: LineDatum[] = [];
  let cumulative = 0;

  for (const candle of ascending(candles)) {
    if (candle.takerBuyVolume === null || candle.takerBuyVolume === undefined) {
      if (current.length > 0) segments.push(current);
      current = [];
      continue; // the running total resumes from where it was; the gap is drawn as a gap
    }
    cumulative += 2 * candle.takerBuyVolume - candle.volume;
    current.push({ time: candle.time, value: cumulative });
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

/** Per-bar taker delta, which the CVD pane draws beneath its line. */
export function toTakerDelta(candles: readonly WebCandle[]): LineDatum[] {
  return ascending(
    candles
      .filter((c) => c.takerBuyVolume !== null && c.takerBuyVolume !== undefined)
      .map((c) => ({ time: c.time, value: 2 * (c.takerBuyVolume as number) - c.volume })),
  );
}

/**
 * Settled funding as a **step**: it holds until the next settlement, so each point is repeated
 * at the instant before the next one. Drawing it as a line between settlements would imply the
 * rate drifted continuously, which is not what a settlement is.
 */
export function toFundingSteps(points: readonly { time: number; rate: number }[]): LineDatum[] {
  const sorted = ascending(points.map((p) => ({ time: p.time, value: p.rate })));
  const out: LineDatum[] = [];
  for (let i = 0; i < sorted.length; i++) {
    out.push(sorted[i]);
    const next = sorted[i + 1];
    if (next) out.push({ time: next.time - 1, value: sorted[i].value });
  }
  return out;
}

export function toPredictedFunding(response: Pick<WebFundingResponse, 'predicted'>): LineDatum[] {
  return ascending(response.predicted.map((p) => ({ time: p.time, value: p.rate })));
}

export function toLongShortLine(response: Pick<WebLongShortResponse, 'points'>): LineDatum[] {
  return ascending(response.points.map((p) => ({ time: p.time, value: p.ratio })));
}

export interface HistogramDatum {
  time: number;
  value: number;
  color: string;
}

/**
 * The liquidation histogram's data: **two bars per bucket, never one**. Longs are drawn positive
 * and shorts negative so the two sides read apart at a glance — the pane's whole purpose is
 * which side was liquidated, and a single summed bar hides the cascade direction.
 */
export function toLiquidationHistogram(
  bars: readonly WebLiquidationBar[],
  colors: { long: string; short: string },
): { longs: HistogramDatum[]; shorts: HistogramDatum[] } {
  const sorted = ascending(bars.map((b) => ({ time: b.time, long: b.long, short: b.short })));
  return {
    longs: sorted.map((b) => ({ time: b.time, value: b.long, color: colors.long })),
    shorts: sorted.map((b) => ({ time: b.time, value: -b.short, color: colors.short })),
  };
}

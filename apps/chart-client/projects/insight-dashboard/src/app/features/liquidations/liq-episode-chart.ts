import type { WebLiquidationEpisode } from '@trade-automation/contracts';

/**
 * IB-134 (liquidation-episodes design E6) — the episode card's mini chart, as plain geometry.
 *
 * The x axis is fixed by the episode, not by the data: the minute of `from` − 60 min to the minute of
 * `to` + 240 min (the server's path window, so the first and the +4 h closes sit on the edges). A path whose
 * «+4 ч» has not passed yet simply ends early (the server sends closed minutes only), so the line
 * stops where the facts stop and the empty right part says "not yet" without words.
 *
 * Coordinates are in a `CHART_W × CHART_H` box the template stretches to the card's width
 * (`preserveAspectRatio="none"`, strokes non-scaling): no axes, as in the mockup.
 */
export const CHART_W = 300;
export const CHART_H = 90;
/** The price line's band (top, bottom); the bars rise from the bottom edge underneath it. */
const PRICE_TOP = 6;
const PRICE_BOTTOM = 56;
const BAR_MAX = 32;
const BAR_MIN = 2;
/** A bar is at least this wide, so a one-minute episode is still visible at 300 px. */
const BAR_MIN_W = 2;
export const BEFORE_SEC = 3_600;
export const AFTER_SEC = 4 * 3_600;

export interface EpisodeChart {
  /** `M x y L …`, or null when the episode has no price (the card says «нет цены»). */
  line: string | null;
  /** The episode itself, `[from, end of to's minute]`. */
  shade: { x: number; width: number };
  bars: Array<{ x: number; y: number; width: number; height: number }>;
}

export function episodeChart(e: Pick<WebLiquidationEpisode, 'from' | 'to' | 'perMinute' | 'price'>): EpisodeChart {
  // the server's path window (IB-133 `pathWindow`): minute opens, from − 60 min to to + 240 min
  const minute = (t: number) => Math.floor(t / 60) * 60;
  const t0 = minute(e.from) - BEFORE_SEC;
  const t1 = minute(e.to) + AFTER_SEC;
  const x = (t: number) => round(((t - t0) / (t1 - t0)) * CHART_W);
  const minuteW = (60 / (t1 - t0)) * CHART_W;

  const shadeFrom = x(e.from);
  const shade = { x: shadeFrom, width: Math.max(BAR_MIN_W, round(x(minute(e.to) + 60) - shadeFrom)) };

  const top = Math.max(...e.perMinute.map((m) => m.usd), 0);
  const barW = round(Math.max(BAR_MIN_W, minuteW));
  const bars = top <= 0 ? [] : e.perMinute.map((m) => {
    const height = round(Math.max(BAR_MIN, (m.usd / top) * BAR_MAX));
    return { x: x(m.time), y: round(CHART_H - height), width: barW, height };
  });

  return { line: priceLine(e.price?.points ?? [], x), shade, bars };
}

function priceLine(points: ReadonlyArray<{ time: number; close: number }>, x: (t: number) => number): string | null {
  if (points.length === 0) return null;
  const closes = points.map((p) => p.close);
  const lo = Math.min(...closes);
  const hi = Math.max(...closes);
  const mid = (PRICE_TOP + PRICE_BOTTOM) / 2;
  const y = (v: number) => (hi === lo ? mid : round(PRICE_TOP + ((hi - v) / (hi - lo)) * (PRICE_BOTTOM - PRICE_TOP)));
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.time)} ${y(p.close)}`).join(' ');
}

const round = (v: number) => Math.round(v * 10) / 10;

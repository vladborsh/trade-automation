import type { WebCoinShare, WebDominancePoint, WebFearGreedPoint, WebMarketCapDay } from '@trade-automation/contracts';

/**
 * IB-037 — the market page's geometry, kept pure and away from the component
 * (AGENTS.md: anything that can be a pure function lives beside the component with its own spec).
 *
 * Everything here turns server rows into SVG coordinates. The charts are inline SVG rather than
 * lightweight-charts: these are daily series of a few hundred points with no crosshair, pan or
 * zoom, and a charting library would cost a bundle and a wrapper for a polyline.
 */

/** The palette (AGENTS.md dark-terminal): BTC picked out, the rest a muted ramp. */
export const BTC_COLOUR = '#f0b90b';
export const BAND_COLOURS = ['#26a69a', '#2f81f7', '#8957e5', '#db6d28', '#3fb950', '#6e7681', '#1f6feb', '#a371f7'];

/** The Fear & Greed bands, as alternative.me defines them — value → the class it belongs to. */
export const FEAR_GREED_BANDS = [
  { upTo: 24, key: 'market.fg.extremeFear', colour: '#ef5350' },
  { upTo: 44, key: 'market.fg.fear', colour: '#db6d28' },
  { upTo: 54, key: 'market.fg.neutral', colour: '#8b949e' },
  { upTo: 74, key: 'market.fg.greed', colour: '#3fb950' },
  { upTo: 100, key: 'market.fg.extremeGreed', colour: '#26a69a' },
] as const;

/**
 * The band a value falls in. The venue also sends its own `classification` string, which is what
 * the page SHOWS (§11 keeps the venue's wording); this is only for the colour and for a
 * translated label when a reader wants one, so the two can never contradict each other about the
 * number — both come from the same value.
 */
export function fearGreedBand(value: number): (typeof FEAR_GREED_BANDS)[number] {
  const clamped = Math.max(0, Math.min(100, value));
  return FEAR_GREED_BANDS.find((band) => clamped <= band.upTo) ?? FEAR_GREED_BANDS[FEAR_GREED_BANDS.length - 1];
}

/**
 * The gauge needle's angle in degrees for 0..100, over a 180° arc starting at -90° (left).
 * Values outside 0..100 are clamped rather than swung off the dial.
 */
export function gaugeAngle(value: number): number {
  return Math.max(0, Math.min(100, value)) * 1.8 - 90;
}

/** A point on the gauge arc, for the needle tip; the dial is drawn in a 100×60 viewBox. */
export function gaugePoint(value: number, radius = 42): { x: number; y: number } {
  const radians = ((gaugeAngle(value) - 90) * Math.PI) / 180;
  return { x: 50 + radius * Math.cos(radians), y: 52 + radius * Math.sin(radians) };
}

export interface LinePoint {
  x: number;
  y: number;
}

/**
 * A polyline over a 0..`width` × 0..`height` box, oldest point at the left.
 *
 * Returns an empty array for fewer than two points: a one-point line is a dot the eye reads as a
 * trend, and a flat series (min === max) is drawn down the middle rather than divided by zero.
 */
export function linePoints(values: readonly (number | null)[], width = 100, height = 40): LinePoint[] {
  const present = values.filter((v): v is number => v !== null);
  if (present.length < 2) return [];
  const min = Math.min(...present);
  const max = Math.max(...present);
  const span = max - min;
  const step = width / (values.length - 1);
  const out: LinePoint[] = [];
  values.forEach((value, index) => {
    if (value === null) return; // a hole breaks the line rather than interpolating over it
    const y = span === 0 ? height / 2 : height - ((value - min) / span) * height;
    out.push({ x: index * step, y });
  });
  return out;
}

/** `linePoints` as an SVG `points` attribute. */
export function polyline(values: readonly (number | null)[], width = 100, height = 40): string {
  return linePoints(values, width, height)
    .map((p) => `${round(p.x)},${round(p.y)}`)
    .join(' ');
}

export interface StackedBand {
  coin: string;
  colour: string;
  /** The SVG path of this coin's band across the days, closed top and bottom. */
  path: string;
}

/**
 * The stacked-share chart: one band per coin, stacked bottom-up in the order given, BTC in its
 * own colour.
 *
 * A day whose shares are all null (nothing collected) contributes no vertex, so the band shows a
 * gap instead of a straight line pretending the mix held steady.
 */
export function stackedBands(days: readonly WebMarketCapDay[], width = 100, height = 40): StackedBand[] {
  if (days.length < 2) return [];
  const coins = days[0].coins.map((c) => c.coin);
  const step = width / (days.length - 1);
  const shareOf = (day: WebMarketCapDay, coin: string): number | null => day.coins.find((c) => c.coin === coin)?.share ?? null;

  const offsets = days.map(() => 0);
  return coins.map((coin, index) => {
    const top: LinePoint[] = [];
    const bottom: LinePoint[] = [];
    days.forEach((day, dayIndex) => {
      const share = shareOf(day, coin);
      if (share === null) return;
      const base = offsets[dayIndex];
      const next = base + share;
      offsets[dayIndex] = next;
      const x = dayIndex * step;
      bottom.push({ x, y: height - base * height });
      top.push({ x, y: height - next * height });
    });
    const path =
      top.length < 2
        ? ''
        : `M ${top.map((p) => `${round(p.x)} ${round(p.y)}`).join(' L ')} L ${[...bottom].reverse().map((p) => `${round(p.x)} ${round(p.y)}`).join(' L ')} Z`;
    return { coin, colour: coin === 'bitcoin' ? BTC_COLOUR : BAND_COLOURS[index % BAND_COLOURS.length], path };
  });
}

/** The BTC-share line (of Σ top-20) as a polyline, holes preserved. */
export function btcShareLine(days: readonly WebMarketCapDay[], width = 100, height = 40): string {
  return polyline(days.map((d) => d.btcShare), width, height);
}

/** The `/global` dominance line; `btcPct` is a percentage, nulls are holes. */
export function dominanceLine(points: readonly WebDominancePoint[], width = 100, height = 40): string {
  return polyline(points.map((p) => p.btcPct), width, height);
}

/** Fear & Greed history as a polyline over its fixed 0..100 scale, not the window's own min/max. */
export function fearGreedLine(points: readonly WebFearGreedPoint[], width = 100, height = 40): string {
  if (points.length < 2) return '';
  const step = width / (points.length - 1);
  return points
    .map((point, index) => `${round(index * step)},${round(height - (Math.max(0, Math.min(100, point.value)) / 100) * height)}`)
    .join(' ');
}

/** The legend: the newest day's coins, largest share first, with their band colours. */
export function shareLegend(days: readonly WebMarketCapDay[]): Array<WebCoinShare & { colour: string }> {
  const bands = new Map(stackedBands(days).map((band) => [band.coin, band.colour]));
  const latest = days.at(-1);
  if (!latest) return [];
  return [...latest.coins]
    .sort((a, b) => (b.share ?? -1) - (a.share ?? -1))
    .map((coin) => ({ ...coin, colour: bands.get(coin.coin) ?? BAND_COLOURS[0] }));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

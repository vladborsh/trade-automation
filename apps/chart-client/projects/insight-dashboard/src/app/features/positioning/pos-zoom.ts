import type { WebPositioningRow } from '@trade-automation/contracts';
import type { Size } from './pos-layout';

/**
 * IB-137 (market round 3 §2) — the quadrant's VIEW: a data domain, never a CSS scale, so dots keep
 * their size and labels are laid out again by the same greedy placer. Everything here is pure.
 *
 * Two named views: «без выбросов» (`bulkDomain`, the default) fits the bulk of the coins and pins
 * the rest to the edge; «весь» (`fullDomain`) fits every coin, as the quadrant did before. `zoom`
 * and `pan` move between them and never past «весь».
 */
export interface Domain {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** The plot area's inset inside the chart box (axis ends and corner names live in it). */
export const QUADRANT_PAD = 28;

/** A round axis end: 1, 2, 5 × 10ⁿ, at least 1 (a flat market still gets readable axes). */
export function niceMax(v: number): number {
  const m = Math.max(1, v);
  const p = 10 ** Math.floor(Math.log10(m));
  return [1, 2, 5, 10].map((k) => k * p).find((x) => x >= m) as number;
}

/** The bulk: the 80th percentile of |Δ| across placed coins, nearest-rank. */
export const BULK_PERCENTILE = 80;
/**
 * A calm market is not zoomed into noise: half-ranges of at least 2 × the server's «flat» bands
 * (`thresholds.ts`: PRICE_FLAT_PCT 0.5, OI_FLAT_PCT 1).
 */
export const BULK_FLOOR = { price: 1, oi: 2 } as const;
/** Zoom-in stops here (half-range, %). */
export const ZOOM_MIN_HALF = { price: 0.25, oi: 0.5 } as const;
/** One press of + or −. */
export const ZOOM_STEP = 1.5;

/** The coins the quadrant can place: both changes measured. */
export function placedRows(rows: readonly WebPositioningRow[]): WebPositioningRow[] {
  return rows.filter((r) => r.priceChangePct.value !== null && r.oiChangePct.value !== null);
}

/** Nearest-rank percentile: the smallest value with at least p % of the values at or below it. */
export function nearestRank(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

const absPrice = (rows: WebPositioningRow[]) => rows.map((r) => Math.abs(r.priceChangePct.value as number));
const absOi = (rows: WebPositioningRow[]) => rows.map((r) => Math.abs(r.oiChangePct.value as number));
const symmetric = (hx: number, hy: number): Domain => ({ xMin: -hx, xMax: hx, yMin: -hy, yMax: hy });

/** «без выбросов»: symmetric around 0 (D9), each half-range niceMax(P80 |Δ|), floored. */
export function bulkDomain(rows: readonly WebPositioningRow[]): Domain {
  const placed = placedRows(rows);
  return symmetric(
    Math.max(BULK_FLOOR.price, niceMax(nearestRank(absPrice(placed), BULK_PERCENTILE))),
    Math.max(BULK_FLOOR.oi, niceMax(nearestRank(absOi(placed), BULK_PERCENTILE))),
  );
}

/**
 * «весь»: niceMax(max |Δ|), symmetric — the quadrant as it was. It carries the same floor as the
 * bulk, so «весь» is never narrower than «без выбросов» (only a market where every |ΔOI| < 1 %
 * notices: ±2 % instead of ±1 %), and zoom-out can always stop at it.
 */
export function fullDomain(rows: readonly WebPositioningRow[]): Domain {
  const placed = placedRows(rows);
  return symmetric(
    Math.max(BULK_FLOOR.price, niceMax(Math.max(0, ...absPrice(placed)))),
    Math.max(BULK_FLOOR.oi, niceMax(Math.max(0, ...absOi(placed)))),
  );
}

/** Shift [min, max] into [lo, hi] without changing its width (it is never wider). */
function clampInto(min: number, max: number, lo: number, hi: number): [number, number] {
  if (min < lo) return [lo, lo + (max - min)];
  if (max > hi) return [hi - (max - min), hi];
  return [min, max];
}

function zoomAxis(min: number, max: number, at: number, factor: number, minHalf: number, lo: number, hi: number): [number, number] {
  const w = max - min;
  const nw = Math.min(hi - lo, Math.max(2 * minHalf, w * factor));
  const a = Math.min(max, Math.max(min, at));
  const nMin = a - ((a - min) * nw) / w;
  return clampInto(nMin, nMin + nw, lo, hi);
}

/**
 * Zoom by `factor` (< 1 in, > 1 out) about `anchor` (data units): the anchor stays where it is on
 * screen. Each axis stops at its ZOOM_MIN_HALF going in and at `limit` («весь») going out, and the
 * result is kept inside `limit`.
 */
export function zoom(d: Domain, factor: number, anchor: { x: number; y: number }, limit: Domain): Domain {
  const [xMin, xMax] = zoomAxis(d.xMin, d.xMax, anchor.x, factor, ZOOM_MIN_HALF.price, limit.xMin, limit.xMax);
  const [yMin, yMax] = zoomAxis(d.yMin, d.yMax, anchor.y, factor, ZOOM_MIN_HALF.oi, limit.yMin, limit.yMax);
  return { xMin, xMax, yMin, yMax };
}

/** Move the view by (dx, dy) data units, clamped so it never leaves `limit`. */
export function pan(d: Domain, dx: number, dy: number, limit: Domain): Domain {
  const [xMin, xMax] = clampInto(d.xMin + dx, d.xMax + dx, limit.xMin, limit.xMax);
  const [yMin, yMax] = clampInto(d.yMin + dy, d.yMax + dy, limit.yMin, limit.yMax);
  return { xMin, xMax, yMin, yMax };
}

export function sameDomain(a: Domain, b: Domain): boolean {
  const eq = (u: number, v: number) => Math.abs(u - v) <= 1e-9 * Math.max(1, Math.abs(u), Math.abs(v));
  return eq(a.xMin, b.xMin) && eq(a.xMax, b.xMax) && eq(a.yMin, b.yMin) && eq(a.yMax, b.yMax);
}

/** The quadrant names hold only while the axes cross inside the view. */
export function originInView(d: Domain): boolean {
  return d.xMin <= 0 && 0 <= d.xMax && d.yMin <= 0 && 0 <= d.yMax;
}

/** Pixels (in the chart's own box) → data, through the same plot area the layout draws in. */
export function dataAt(d: Domain, size: Size, px: number, py: number): { x: number; y: number } {
  const w = size.width - 2 * QUADRANT_PAD;
  const h = size.height - 2 * QUADRANT_PAD;
  return { x: d.xMin + ((px - QUADRANT_PAD) / w) * (d.xMax - d.xMin), y: d.yMax - ((py - QUADRANT_PAD) / h) * (d.yMax - d.yMin) };
}

/** A drag of (dxPx, dyPx) as a pan in data units: the content follows the finger. */
export function panByPx(d: Domain, size: Size, dxPx: number, dyPx: number, limit: Domain): Domain {
  const ux = (d.xMax - d.xMin) / (size.width - 2 * QUADRANT_PAD);
  const uy = (d.yMax - d.yMin) / (size.height - 2 * QUADRANT_PAD);
  return pan(d, -dxPx * ux, dyPx * uy, limit);
}

/**
 * A percentage short enough for an axis end or a pinned label: «+38 %», «−2.8 %», «+0.25 %».
 * Two significant-ish digits; the page's minus sign; zero unsigned.
 */
export function compactPct(v: number): string {
  const a = Math.abs(v);
  const digits = a >= 10 ? 0 : a >= 1 ? 1 : 2;
  const text = String(Number(a.toFixed(digits)));
  if (text === '0') return '0 %';
  return `${v > 0 ? '+' : '−'}${text} %`;
}

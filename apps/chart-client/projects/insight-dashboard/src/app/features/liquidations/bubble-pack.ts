/**
 * IB-BUG-042 — packing one side of the bubble timeline (shorts above the axis, or longs below) so that
 * no two circles overlap and every one stays inside its half.
 *
 * Before this, a bubble that met one already placed in its column moved outward, and a column taller
 * than its half was clamped to the edge: hundreds of 7d prints in one hour piled up there, drawn over
 * each other. Now, in order:
 * 1. each bubble (biggest first, so nearest the axis) takes the smallest distance from the axis at
 *    which it touches no circle already placed — a true circle test, not a column one;
 * 2. if any bubble finds no such place, every radius shrinks by the same factor (area ∝ money still
 *    holds between all bubbles) and the side is packed again — but never below half size: a series of
 *    26 prints in one minute (the captured Market block) fits at NO radius, and shrinking everything to
 *    the 3 px minimum for it turned every bubble on the chart into the same dot, the $1.7M one too;
 * 3. if bubbles still do not fit at that scale, a band at the outer edge is kept for «+N» marks and the
 *    bubbles that do not fit (the smallest: the biggest are placed first) are counted there, at their
 *    place on the time axis — never drawn over another.
 * Both sides share one scale (the caller takes the smaller), so the same money is the same size above
 * and below the axis.
 */

export interface PackItem {
  /** The bubble's centre on the time axis, px. Fixed: a bubble never moves sideways. */
  cx: number;
  usd: number;
}

export interface PackGeometry {
  /** From the axis to this side's outer edge, px. */
  room: number;
  /** The radius of the largest event at scale 1. */
  rMax: number;
  rMin: number;
  usdMax: number;
  /** The chart's width: a «+N» mark stays inside it. */
  width: number;
}

export interface PackedBubble {
  /** Index into the items passed in. */
  index: number;
  /** Distance of the centre from the axis, px (outward). */
  offset: number;
  r: number;
}

export interface MoreMark {
  /** The label's centre on the time axis (`text-anchor: middle`). */
  x: number;
  count: number;
}

export interface PackResult {
  bubbles: PackedBubble[];
  more: MoreMark[];
  /** The radius factor used: 1 when everything fitted at full size. */
  scale: number;
}

/** Empty space between two circles' edges: their 1 px strokes (half outside the radius) only touch. */
export const BUBBLE_GAP = 1;
/** A bubble's edge stays this far off the axis line. */
export const BUBBLE_AXIS_GAP = 2;
/** IB-BUG-036: the outermost bubble's edge stays this far from the side's edge, so its stroke is never cut. */
export const BUBBLE_EDGE_GAP = 1;
/** Each pass shrinks every radius by this factor, down to BUBBLE_MIN_SCALE and no further. */
export const BUBBLE_SHRINK = 0.8;
export const BUBBLE_MIN_SCALE = 0.5;
/** The «+N» band at the outer edge of a side whose bubbles do not fit at the minimum radius. */
export const MORE_BAND_PX = 14;
/** «+N» glyph advance (IBM Plex Mono 12 px, as the axis labels) and the least air between two marks. */
export const MORE_CHAR_PX = 7.2;
export const MORE_AIR_PX = 4;

export const moreLabel = (count: number): string => `+${count}`;
export const moreWidth = (count: number): number => moreLabel(count).length * MORE_CHAR_PX;

/** The radius of each item at a scale: ∝ √USD, never below the minimum. */
function radius(item: PackItem, g: PackGeometry, scale: number): number {
  const top = Math.max(g.rMin, g.rMax * scale);
  return g.usdMax > 0 ? Math.max(g.rMin, top * Math.sqrt(item.usd / g.usdMax)) : g.rMin;
}

/**
 * The smallest offset in [lo, hi] at which a circle of radius r at cx touches none of `placed`, or null.
 * Each placed circle within reach forbids an open interval of offsets around its own.
 */
function firstFree(cx: number, r: number, lo: number, hi: number, placed: readonly { cx: number; offset: number; r: number }[]): number | null {
  const blocked: Array<[number, number]> = [];
  for (const p of placed) {
    const reach = p.r + r + BUBBLE_GAP;
    const dx = Math.abs(p.cx - cx);
    if (dx >= reach) continue;
    const half = Math.sqrt(reach * reach - dx * dx);
    blocked.push([p.offset - half, p.offset + half]);
  }
  blocked.sort((a, b) => a[0] - b[0]);
  let o = lo;
  for (const [start, end] of blocked) {
    if (start >= o) break; // sorted by start: no later interval can contain o either
    if (end > o) o = end;
  }
  return o <= hi ? o : null;
}

/** One pass at a scale: what fits, and the indices that do not. */
function place(items: readonly PackItem[], order: readonly number[], g: PackGeometry, scale: number, room: number) {
  const placed: Array<PackedBubble & { cx: number }> = [];
  const left: number[] = [];
  for (const index of order) {
    const item = items[index];
    const r = radius(item, g, scale);
    const offset = firstFree(item.cx, r, r + BUBBLE_AXIS_GAP, room - r - BUBBLE_EDGE_GAP, placed);
    if (offset === null) left.push(index);
    else placed.push({ index, offset, r, cx: item.cx });
  }
  return { placed, left };
}

/** The largest scale (1, 0.8, 0.64, …) at which every item of one side fits; BUBBLE_MIN_SCALE if none does. */
export function fittingScale(items: readonly PackItem[], g: PackGeometry): number {
  const order = byUsd(items);
  for (let scale = 1; scale >= BUBBLE_MIN_SCALE && g.rMax * scale > g.rMin; scale *= BUBBLE_SHRINK) {
    if (place(items, order, g, scale, g.room).left.length === 0) return scale;
  }
  return BUBBLE_MIN_SCALE;
}

/** Pack one side at a given scale (the smaller of the two sides' `fittingScale`). */
export function packSide(items: readonly PackItem[], g: PackGeometry, scale: number): PackResult {
  const order = byUsd(items);
  const full = place(items, order, g, scale, g.room);
  if (full.left.length === 0) return { bubbles: strip(full.placed), more: [], scale };
  // Still too many: keep a band for the marks, and count there whatever has no place below it.
  const banded = place(items, order, g, scale, Math.max(0, g.room - MORE_BAND_PX));
  return { bubbles: strip(banded.placed), more: moreMarks(banded.left.map((i) => items[i].cx), g.width), scale };
}

function byUsd(items: readonly PackItem[]): number[] {
  return items.map((_, i) => i).sort((a, b) => items[b].usd - items[a].usd || items[a].cx - items[b].cx);
}

function strip(placed: ReadonlyArray<PackedBubble & { cx: number }>): PackedBubble[] {
  return placed.map(({ index, offset, r }) => ({ index, offset, r }));
}

/**
 * The «+N» marks for the bubbles left over, at their place on the time axis: neighbours whose labels
 * would touch are merged (count-weighted centre), and a label never crosses the chart's edge.
 */
export function moreMarks(xs: readonly number[], width: number): MoreMark[] {
  type Group = { sum: number; count: number };
  const groups: Group[] = [...xs].sort((a, b) => a - b).map((x) => ({ sum: x, count: 1 }));
  const at = (gr: Group) => {
    const w = moreWidth(gr.count);
    return Math.min(Math.max(gr.sum / gr.count, w / 2), Math.max(w / 2, width - w / 2));
  };
  for (let merged = true; merged && groups.length > 1;) {
    merged = false;
    for (let i = 1; i < groups.length; i++) {
      const [a, b] = [groups[i - 1], groups[i]];
      if (at(b) - at(a) < (moreWidth(a.count) + moreWidth(b.count)) / 2 + MORE_AIR_PX) {
        groups.splice(i - 1, 2, { sum: a.sum + b.sum, count: a.count + b.count });
        merged = true;
        break;
      }
    }
  }
  return groups.map((gr) => ({ x: at(gr), count: gr.count }));
}

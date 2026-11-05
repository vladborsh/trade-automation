import type { WebMarketPeriod, WebPositioningCell, WebPositioningRow, WebPositioningSignal } from '@trade-automation/contracts';
import { WEB_MARKET_PERIOD_SECONDS } from '@trade-automation/contracts';
import type { StringKey } from '../../i18n/keys';
import { formatUsd } from '../liquidations/liquidations.format';
import { fundingPct, signedPct } from '../market/shell/market-text';
import { compactPct, type Domain, fullDomain, originInView, placedRows, QUADRANT_PAD } from './pos-zoom';

/**
 * IB-090 (market-page design D9, D12) — the positioning block's geometry and cell words, computed
 * here and nowhere else; the components only place what these return.
 */

export interface Size {
  width: number;
  height: number;
}

/* IB-137: the view maths (and niceMax, the plot inset) live in pos-zoom.ts; re-exported for old imports. */
export { niceMax, QUADRANT_PAD } from './pos-zoom';
export const DOT_R_MIN = 4;
export const DOT_R_MAX = 16;
/** IB-137: a pinned coin's arrow — its collision box half-size and its tap target's radius. */
export const PIN_R = 7;
/** A label's box at 12 px monospace: ~7.3 px per character, 14 px tall. */
export const LABEL_CHAR_PX = 7.3;
export const LABEL_H = 14;

/** IB-137: which edge(s) a coin outside the view is pinned to: −1 left/below, +1 right/above. */
export interface Pin {
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
  /** The arrow's direction in SVG degrees (0 = right, −90 = up). */
  angle: number;
}

export interface QuadrantDot {
  row: WebPositioningRow;
  cx: number;
  cy: number;
  r: number;
  /** IB-137: null inside the view; outside, the edge it is pinned to (drawn as an outward arrow). */
  pin: Pin | null;
  /** Where its label goes; null when every candidate spot collided (the dot still shows, titled). */
  label: { x: number; y: number; anchor: 'start' | 'end' | 'middle'; box: Box; text: string } | null;
}

export interface QuadrantLayout {
  domain: Domain;
  /** The zero axes in pixels, clamped to the plot edge when zero is outside the view. */
  x0: number;
  y0: number;
  /** IB-137: whether each zero axis is inside the view (outside, a «0» marker sits on the edge). */
  x0In: boolean;
  y0In: boolean;
  /** The four quadrant names are drawn only while the axes cross inside the view. */
  originIn: boolean;
  /** Plot area edges in pixels. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** In OI order, biggest first: the keyboard's order too. */
  dots: QuadrantDot[];
  /** Coins without both changes cannot be placed: counted, not guessed at the origin. */
  unplaced: number;
  /** Labels skipped because there was no free spot. */
  hiddenLabels: number;
  /** IB-137: coins drawn on the edge. */
  pinned: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const side = (v: number, lo: number, hi: number): -1 | 0 | 1 => (v < lo ? -1 : v > hi ? 1 : 0);

/**
 * D9: price change across, OI change up, one dot per coin sized by OI in USD (area ∝ OI). IB-137:
 * the axes span `domain` (default «весь», symmetric around 0); a coin outside it is drawn ON THE
 * EDGE at its clamped position — the sign kept, so the quadrant stays right — as an outward arrow
 * labelled with its true values. Labels are placed greedily, pinned coins first (their label carries
 * what their position cannot), then biggest coin first: right, left, above, below (a pinned label
 * tries the inward side first); a label that would overlap another label or a dot is dropped.
 */
export function quadrantLayout(rows: readonly WebPositioningRow[], size: Size, domain: Domain = fullDomain(rows)): QuadrantLayout {
  const placed = placedRows(rows);
  const left = QUADRANT_PAD;
  const right = size.width - QUADRANT_PAD;
  const top = QUADRANT_PAD;
  const bottom = size.height - QUADRANT_PAD;
  const px = (x: number) => left + ((x - domain.xMin) / (domain.xMax - domain.xMin)) * (right - left);
  const py = (y: number) => top + ((domain.yMax - y) / (domain.yMax - domain.yMin)) * (bottom - top);
  const oiMax = Math.max(0, ...placed.map((r) => r.oiUsd ?? 0));

  const dots: QuadrantDot[] = [...placed]
    .sort((a, b) => (b.oiUsd ?? 0) - (a.oiUsd ?? 0) || a.symbol.localeCompare(b.symbol))
    .map((row) => {
      const x = row.priceChangePct.value as number;
      const y = row.oiChangePct.value as number;
      const dx = side(x, domain.xMin, domain.xMax);
      const dy = side(y, domain.yMin, domain.yMax);
      const pin: Pin | null = dx === 0 && dy === 0 ? null : { dx, dy, angle: (Math.atan2(-dy || 0, dx) * 180) / Math.PI };
      const r = pin ? PIN_R : row.oiUsd !== null && oiMax > 0 ? Math.max(DOT_R_MIN, DOT_R_MAX * Math.sqrt(row.oiUsd / oiMax)) : DOT_R_MIN;
      return { row, cx: clamp(px(x), left, right), cy: clamp(py(y), top, bottom), r, pin, label: null };
    });

  const boxes: Box[] = dots.map((d) => ({ x: d.cx - d.r, y: d.cy - d.r, w: 2 * d.r, h: 2 * d.r }));
  let hidden = 0;
  // pinned first, the farthest beyond the view first: a real outlier's label beats a coin just past the edge
  const beyond = (v: number, lo: number, hi: number) => (v > hi ? v - hi : v < lo ? lo - v : 0) / (hi - lo);
  const outness = (d: QuadrantDot) => Math.max(
    beyond(d.row.priceChangePct.value as number, domain.xMin, domain.xMax), beyond(d.row.oiChangePct.value as number, domain.yMin, domain.yMax));
  const pinnedFirst = dots.filter((x) => x.pin).sort((a, b) => outness(b) - outness(a));
  for (const d of [...pinnedFirst, ...dots.filter((x) => !x.pin)]) {
    const text = d.pin
      ? `${d.row.base} ${compactPct(d.row.priceChangePct.value as number)} / ${compactPct(d.row.oiChangePct.value as number)}`
      : d.row.base;
    const w = text.length * LABEL_CHAR_PX;
    // text baseline = box top + 11 (12 px glyphs in a 14 px box)
    const at = (x: number, y: number, anchor: 'start' | 'end' | 'middle') => {
      const l = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
      return { x, y: y + 11, anchor, box: { x: l, y, w, h: LABEL_H }, text };
    };
    const r = at(d.cx + d.r + 3, d.cy - LABEL_H / 2, 'start');
    const l = at(d.cx - d.r - 3, d.cy - LABEL_H / 2, 'end');
    const a = at(d.cx, d.cy - d.r - 2 - LABEL_H, 'middle');
    const b = at(d.cx, d.cy + d.r + 2, 'middle');
    // a corner pin: below / above, aligned to its edge so the label runs inward
    const edgeX = d.pin?.dx === 1 ? d.cx + d.r : d.cx - d.r;
    const edgeAnchor = d.pin?.dx === 1 ? 'end' : 'start';
    const bIn = at(edgeX, d.cy + d.r + 2, edgeAnchor);
    const aIn = at(edgeX, d.cy - d.r - 2 - LABEL_H, edgeAnchor);
    const spots = !d.pin ? [r, l, a, b]
      : d.pin.dy === 1 ? (d.pin.dx === 0 ? [b, r, l, a] : [b, bIn, d.pin.dx === 1 ? l : r, aIn])
      : d.pin.dy === -1 ? (d.pin.dx === 0 ? [a, r, l, b] : [a, aIn, d.pin.dx === 1 ? l : r, bIn])
      : d.pin.dx === 1 ? [l, a, b, r] : [r, a, b, l];
    const free = spots.find((s) => inside(s.box, size) && boxes.every((bx) => !overlaps(bx, s.box)));
    if (free) {
      d.label = free;
      boxes.push(free.box);
    } else {
      hidden++;
    }
  }
  const x0In = domain.xMin <= 0 && 0 <= domain.xMax;
  const y0In = domain.yMin <= 0 && 0 <= domain.yMax;
  return {
    domain, left, right, top, bottom,
    x0: clamp(px(0), left, right), y0: clamp(py(0), top, bottom), x0In, y0In, originIn: originInView(domain),
    dots, unplaced: rows.length - placed.length, hiddenLabels: hidden, pinned: dots.filter((d) => d.pin).length,
  };
}

/**
 * IB-137: a coin's link from the quadrant is R4's (IB-BUG-023) — the instrument at the START of the
 * period the dot measures, `span` marking it as a period start. The period ends at the answer's
 * `asOf` (the moment the server measured), which is R4's «now».
 */
export function quadrantLink(symbol: string, asOf: number, period: WebMarketPeriod): { commands: string[]; queryParams: { at: number; span: WebMarketPeriod } } {
  return { commands: ['/instrument', symbol], queryParams: { at: asOf - WEB_MARKET_PERIOD_SECONDS[period], span: period } };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function inside(b: Box, size: Size): boolean {
  return b.x >= 0 && b.y >= 0 && b.x + b.w <= size.width && b.y + b.h <= size.height;
}

// ------------------------------------------------------------------------------------------------
// The heat table

export const HEAT_COLUMNS = ['priceChangePct', 'oiChangePct', 'fundingRate', 'lsGlobal', 'lsTopPosition', 'liqUsd'] as const;
export type HeatColumn = (typeof HEAT_COLUMNS)[number];

/**
 * How unusual a cell is — by RARITY, never by sign (D2: a rare fall and a rare rise are equally
 * worth a look; the sign is in the number). `none` is the absence of a measurement and is drawn
 * differently from `typical`: «we cannot say» must not read as «normal».
 */
export type Heat = 'none' | 'typical' | 'notable' | 'unusual' | 'extreme';

export function heatOf(rarity: number | null): Heat {
  if (rarity === null) return 'none';
  if (rarity >= 0.99) return 'extreme';
  if (rarity >= 0.9) return 'unusual';
  if (rarity >= 0.75) return 'notable';
  return 'typical';
}

export interface HeatCell {
  text: string | null;
  heat: Heat;
  /** Why there is no value or no rarity — the cell's title, in words. */
  reasonKey: StringKey | null;
}

export interface HeatRow {
  symbol: string;
  base: string;
  cells: Record<HeatColumn, HeatCell>;
  signalKey: StringKey | null;
  /** The row's highest rarity — the default sort; −1 when no cell has one. */
  maxRarity: number;
}

export function heatRow(row: WebPositioningRow): HeatRow {
  const cell = (c: WebPositioningCell, format: (v: number) => string | null): HeatCell => ({
    text: c.value === null ? null : format(c.value),
    heat: heatOf(c.rarity),
    reasonKey: c.unavailable === null ? null : (`positioning.unavailable.${c.unavailable}` as StringKey),
  });
  const ratio = (v: number) => v.toFixed(2);
  return {
    symbol: row.symbol,
    base: row.base,
    cells: {
      priceChangePct: cell(row.priceChangePct, signedPct),
      oiChangePct: cell(row.oiChangePct, signedPct),
      fundingRate: cell(row.fundingRate, fundingPct),
      lsGlobal: cell(row.lsGlobal, ratio),
      lsTopPosition: cell(row.lsTopPosition, ratio),
      liqUsd: cell(row.liqUsd, formatUsd),
    },
    signalKey: row.signal === null ? null : signalKey(row.signal),
    maxRarity: Math.max(-1, ...HEAT_COLUMNS.map((k) => row[k].rarity ?? -1)),
  };
}

export function signalKey(s: WebPositioningSignal): StringKey {
  return `positioning.signal.${s}` as StringKey;
}

/** Rows the heat table shows on a phone before «показать все». */
export const PHONE_HEAT_LIMIT = 10;

/* IB-103: sorting moved to pos-sort.ts (sortRows: any column's value or rarity, OI, ticker; ties by ticker). */

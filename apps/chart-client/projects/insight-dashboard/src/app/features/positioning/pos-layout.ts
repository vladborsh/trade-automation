import type { WebPositioningCell, WebPositioningRow, WebPositioningSignal } from '@trade-automation/contracts';
import type { StringKey } from '../../i18n/keys';
import { formatUsd } from '../liquidations/liquidations.format';
import { fundingPct, signedPct } from '../market/shell/market-text';

/**
 * IB-090 (market-page design D9, D12) — the positioning block's geometry and cell words, computed
 * here and nowhere else; the components only place what these return.
 */

export interface Size {
  width: number;
  height: number;
}

export const QUADRANT_PAD = 28;
export const DOT_R_MIN = 4;
export const DOT_R_MAX = 16;
/** A label's box at 12 px monospace: ~7.3 px per character, 14 px tall. */
export const LABEL_CHAR_PX = 7.3;
export const LABEL_H = 14;

export interface QuadrantDot {
  row: WebPositioningRow;
  cx: number;
  cy: number;
  r: number;
  /** Where its ticker goes; null when every candidate spot collided (the dot still shows, titled). */
  label: { x: number; y: number; anchor: 'start' | 'end' | 'middle'; box: Box } | null;
}

export interface QuadrantLayout {
  /** The zero axes. */
  x0: number;
  y0: number;
  /** ±max |Δ| on each axis, so zero is the centre and the four quadrants are the same size. */
  xMax: number;
  yMax: number;
  dots: QuadrantDot[];
  /** Coins without both changes cannot be placed: counted, not guessed at the origin. */
  unplaced: number;
  /** Labels skipped because there was no free spot. */
  hiddenLabels: number;
}

/**
 * D9: price change across, OI change up, one dot per coin sized by OI in USD (area ∝ OI). Both
 * scales are SYMMETRIC around 0 — the quadrant a dot sits in is the reading, so the axes must cross
 * at the centre. Labels are placed greedily, biggest coin first: right, left, above, below; a label
 * that would overlap another label or a dot is dropped rather than drawn on top.
 */
export function quadrantLayout(rows: readonly WebPositioningRow[], size: Size): QuadrantLayout {
  const placed = rows.filter((r) => r.priceChangePct.value !== null && r.oiChangePct.value !== null);
  const xMax = niceMax(Math.max(0, ...placed.map((r) => Math.abs(r.priceChangePct.value as number))));
  const yMax = niceMax(Math.max(0, ...placed.map((r) => Math.abs(r.oiChangePct.value as number))));
  const x0 = size.width / 2;
  const y0 = size.height / 2;
  const halfW = size.width / 2 - QUADRANT_PAD;
  const halfH = size.height / 2 - QUADRANT_PAD;
  const oiMax = Math.max(0, ...placed.map((r) => r.oiUsd ?? 0));

  const dots: QuadrantDot[] = [...placed]
    .sort((a, b) => (b.oiUsd ?? 0) - (a.oiUsd ?? 0) || a.symbol.localeCompare(b.symbol))
    .map((row) => ({
      row,
      cx: x0 + ((row.priceChangePct.value as number) / xMax) * halfW,
      cy: y0 - ((row.oiChangePct.value as number) / yMax) * halfH,
      r: row.oiUsd !== null && oiMax > 0 ? Math.max(DOT_R_MIN, DOT_R_MAX * Math.sqrt(row.oiUsd / oiMax)) : DOT_R_MIN,
      label: null,
    }));

  const boxes: Box[] = dots.map((d) => ({ x: d.cx - d.r, y: d.cy - d.r, w: 2 * d.r, h: 2 * d.r }));
  let hidden = 0;
  for (const d of dots) {
    const w = d.row.base.length * LABEL_CHAR_PX;
    // text baseline = box top + 11 (12 px glyphs in a 14 px box)
    const at = (x: number, y: number, anchor: 'start' | 'end' | 'middle') => {
      const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
      return { x, y: y + 11, anchor, box: { x: left, y, w, h: LABEL_H } };
    };
    const spots = [
      at(d.cx + d.r + 3, d.cy - LABEL_H / 2, 'start'),
      at(d.cx - d.r - 3, d.cy - LABEL_H / 2, 'end'),
      at(d.cx, d.cy - d.r - 2 - LABEL_H, 'middle'),
      at(d.cx, d.cy + d.r + 2, 'middle'),
    ];
    const free = spots.find((s) => inside(s.box, size) && boxes.every((b) => !overlaps(b, s.box)));
    if (free) {
      d.label = free;
      boxes.push(free.box);
    } else {
      hidden++;
    }
  }
  return { x0, y0, xMax, yMax, dots, unplaced: rows.length - placed.length, hiddenLabels: hidden };
}

/** A round axis end: 1, 2, 5 × 10ⁿ, at least 1 (a flat market still gets readable axes). */
export function niceMax(v: number): number {
  const m = Math.max(1, v);
  const p = 10 ** Math.floor(Math.log10(m));
  return [1, 2, 5, 10].map((k) => k * p).find((x) => x >= m) as number;
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

export type HeatSort = { column: HeatColumn | 'rarity' | 'base'; dir: 'asc' | 'desc' };

/**
 * Sort by a column's VALUE (the default is the row's highest rarity, so the unusual rows come
 * first). A missing value always sinks to the bottom, whichever way the column is sorted: an
 * absence is not the smallest number. Ties keep universe order (a stable sort).
 */
export function sortHeat(rows: readonly WebPositioningRow[], sort: HeatSort): WebPositioningRow[] {
  const key = (r: WebPositioningRow): number | string | null =>
    sort.column === 'base' ? r.base
      : sort.column === 'rarity' ? (heatRow(r).maxRarity < 0 ? null : heatRow(r).maxRarity)
      : r[sort.column].value;
  const sign = sort.dir === 'asc' ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i, k: key(r) }))
    .sort((a, b) => {
      if (a.k === null || b.k === null) return a.k === b.k ? a.i - b.i : a.k === null ? 1 : -1;
      const c = typeof a.k === 'string' ? a.k.localeCompare(b.k as string) : a.k - (b.k as number);
      return c !== 0 ? sign * c : a.i - b.i;
    })
    .map((x) => x.r);
}

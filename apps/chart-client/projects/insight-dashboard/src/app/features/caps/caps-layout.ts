import type { WebCapsCoin, WebCapsDominance } from '@trade-automation/contracts';
import type { StringKey } from '../../i18n/keys';

/**
 * IB-090 (market-page design D11, D12) — the caps block's geometry: a squarified treemap (area =
 * market cap), its colour scale (24h change, symmetric around 0), and the dominance bar.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Tile<T> extends Rect {
  item: T;
}

/**
 * Squarified treemap (Bruls, Huizing, van Wijk 2000): items in the order given (largest first,
 * as the server sends them), laid out in rows along the shorter side; a row grows while that
 * improves its worst aspect ratio. Areas are exactly proportional to `value` and sum to the
 * container's; the same input always gives the same tiles (no sorting here, no randomness).
 */
export function squarify<T>(items: readonly T[], value: (t: T) => number, rect: Rect): Tile<T>[] {
  const positive = items.filter((t) => value(t) > 0);
  const total = positive.reduce((s, t) => s + value(t), 0);
  if (positive.length === 0 || total <= 0 || rect.w <= 0 || rect.h <= 0) return [];
  const scale = (rect.w * rect.h) / total;
  const out: Tile<T>[] = [];
  let free = { ...rect };
  let i = 0;
  while (i < positive.length) {
    const side = Math.min(free.w, free.h);
    const row: T[] = [positive[i]];
    let rowArea = value(positive[i]) * scale;
    let best = worst(row.map((t) => value(t) * scale), rowArea, side);
    let j = i + 1;
    while (j < positive.length) {
      const a = value(positive[j]) * scale;
      const next = worst([...row.map((t) => value(t) * scale), a], rowArea + a, side);
      if (next > best) break;
      row.push(positive[j]);
      rowArea += a;
      best = next;
      j++;
    }
    // lay the row along the shorter side, then shrink the free rectangle
    const thick = rowArea / side;
    let offset = 0;
    for (const t of row) {
      const len = (value(t) * scale) / thick;
      out.push(free.w >= free.h
        ? { item: t, x: free.x, y: free.y + offset, w: thick, h: len }
        : { item: t, x: free.x + offset, y: free.y, w: len, h: thick });
      offset += len;
    }
    free = free.w >= free.h
      ? { x: free.x + thick, y: free.y, w: free.w - thick, h: free.h }
      : { x: free.x, y: free.y + thick, w: free.w, h: free.h - thick };
    i = j;
  }
  return out;
}

/** The worst (largest) aspect ratio in a row of areas laid along `side`. */
function worst(areas: number[], sum: number, side: number): number {
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  const s2 = side * side;
  const sum2 = sum * sum;
  return Math.max((s2 * max) / sum2, sum2 / (s2 * min));
}

/**
 * The colour scale's half-range: ±max |change| over the coins shown, rounded up to a whole
 * percent and at least 1 %, so a quiet day is not painted as a dramatic one.
 */
export function changeScale(changes: readonly (number | null)[]): number {
  const m = Math.max(0, ...changes.filter((c): c is number => c !== null).map(Math.abs));
  return Math.max(1, Math.ceil(m));
}

export const NEUTRAL_TILE = '#21262d';
// IB-108 (§7.6): the mockup's deep endpoints — the scale (its half-range, its linearity) is unchanged
const UP = [31, 138, 126];   // #1f8a7e
const DOWN = [179, 48, 44];  // #b3302c
const BASE = [33, 38, 45];   // NEUTRAL_TILE = --gray-800

/**
 * Symmetric around 0: +x % and −x % are the same distance from neutral, green and red. A null
 * change (no figure, or the period refused) is the neutral tile — the caller says why in words.
 */
export function changeColour(change: number | null, scale: number): string {
  if (change === null || scale <= 0) return NEUTRAL_TILE;
  const k = Math.min(1, Math.abs(change) / scale);
  const to = change >= 0 ? UP : DOWN;
  // linear from neutral: a +0.02 % coin is nearly neutral, as it should look — no floor that would
  // paint a non-move like a move
  const mix = BASE.map((b, i) => Math.round(b + (to[i] - b) * k));
  return change === 0 ? NEUTRAL_TILE : `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
}

/** IB-108: label metrics — 13 px semibold ticker and 12 px mono change, 6 px in from the tile's edge. */
export const TICKER_CHAR_PX = 8.2;
export const CHANGE_CHAR_PX = 7.3;
export const TILE_TEXT_PAD = 6;

/**
 * Which labels fit in a tile: ticker and change, ticker only, or nothing (the title still has it).
 * IB-108: measured against the label itself — a tile shows a text only when the whole of it fits,
 * so «−2.63 %» is never cut to «−2.63 9» by its neighbour. Without a label: the old size rule.
 */
export function tileText(t: Rect, label?: { symbol: string; change: string }): 'full' | 'ticker' | 'none' {
  if (!label) {
    if (t.w >= 46 && t.h >= 34) return 'full';
    if (t.w >= 30 && t.h >= 16) return 'ticker';
    return 'none';
  }
  const room = t.w - 2 * TILE_TEXT_PAD;
  const ticker = label.symbol.length * TICKER_CHAR_PX;
  const change = label.change.length * CHANGE_CHAR_PX;
  if (t.h >= 40 && room >= Math.max(ticker, change)) return 'full';
  if (t.h >= 22 && room >= ticker) return 'ticker';
  return 'none';
}

/**
 * IB-108 (§7.6): the two largest coins (the server sends them first) get the big label — the
 * ticker at `--type-h2` and «$cap · change» at the tile's foot — when the tile has room for it.
 */
export const BIG_TILES = 2;
export function bigTile(index: number, t: Rect): boolean {
  return index < BIG_TILES && t.w >= 110 && t.h >= 72;
}

export interface DominanceSegment {
  key: StringKey;
  pct: number;
  /** Left edge, percent of the bar. */
  left: number;
  colour: string;
  /** IB-108: the label sits inside the segment when it is wide enough; the bar's title has them all. */
  inside: boolean;
  /** Text colour on this fill: dark on the light fills, light on the dark ones. */
  ink: 'dark' | 'light';
}

/** A segment narrower than this share of the bar takes no label inside (it would not fit «ETH 10.6»). */
export const SEGMENT_LABEL_MIN_PCT = 8;

/** D11: BTC / ETH / stables / everything else, left to right, the four summing to 100. IB-108: the mockup's fills. */
export function dominanceSegments(d: WebCapsDominance): DominanceSegment[] {
  const parts: Array<[StringKey, number, string, DominanceSegment['ink']]> = [
    ['caps.dominance.btc', d.btcPct, 'var(--amber-500)', 'dark'],
    ['caps.dominance.eth', d.ethPct, 'var(--blue-400)', 'dark'],
    ['caps.dominance.stables', d.stablesPct, 'var(--gray-500)', 'light'],
    ['caps.dominance.rest', d.restPct, 'var(--gray-700)', 'light'],
  ];
  let left = 0;
  return parts.map(([key, pct, colour, ink]) => {
    const seg = { key, pct, left, colour, inside: pct >= SEGMENT_LABEL_MIN_PCT, ink };
    left += pct;
    return seg;
  });
}

/**
 * The scale for a set of coins. Stablecoins are left out of it: their ±0.01 % would not move it,
 * but a depeg's −3 % would paint every other coin pale — they still get a colour on that scale.
 */
export function capsScale(coins: readonly WebCapsCoin[]): number {
  return changeScale(coins.filter((c) => !c.stable).map((c) => c.changePct));
}

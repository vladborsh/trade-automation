import { isStopTooClose, modifyLevelError, positionSize } from '@trade-automation/replay-core';
import type { PositionToolPart, PositionToolState, PositionToolsView } from './position-tool.model';

/**
 * backtest-app-system-design.md §9.1 — the position tool's pure geometry: labels, handle
 * positions, hit-testing and the drag rules. No canvas and no chart here; the primitive and the
 * controller feed it coordinates.
 */

/** A price rounded to the instrument's `pricePrecision` decimals. */
export function snapPrice(price: number, precision: number): number {
  return Number(price.toFixed(precision));
}

/** Reward over risk: `|tp − entry| / |entry − sl|`; null without a target or with a zero stop. */
export function rMultiple(tool: Pick<PositionToolState, 'entry' | 'sl' | 'tp'>): number | null {
  const risk = Math.abs(tool.entry - tool.sl);
  return tool.tp === null || risk === 0 ? null : Math.abs(tool.tp - tool.entry) / risk;
}

/** Up to 4 significant digits, no exponent for the sizes this app sees. */
export function formatQty(qty: number): string {
  return String(Number(qty.toPrecision(4)));
}

type LabelContext = Pick<PositionToolsView, 'balance' | 'riskPct' | 'pricePrecision' | 'contract'>;

/**
 * The right-edge label of one level: price, distance from the entry, R multiple, and on the
 * entry the qty that replay-core's `positionSize` gives at the session's balance and risk % (on the
 * venue step when the contract is known, as the order popup sizes it; T-054).
 * A stop closer than the minimum distance (`isStopTooClose`, the server's own rule) says so on
 * the entry label instead of a qty, before T-023 ever tries to place the order.
 */
export function labelFor(tool: PositionToolState, level: 'entry' | 'sl' | 'tp', ctx: LabelContext): string {
  const fmt = (p: number) => p.toFixed(ctx.pricePrecision);
  const signed = (d: number) => `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(ctx.pricePrecision)}`;
  if (tool.order) return liveLabel(tool, tool.order, level, fmt, signed);
  if (level === 'entry') {
    const head = `${tool.side === 'long' ? 'Long' : 'Short'} ${tool.mode} ${fmt(tool.entry)}`;
    if (tool.entry === tool.sl || isStopTooClose(tool.entry, tool.sl)) return `${head} · stop too close`;
    try {
      return `${head} · qty ${formatQty(positionSize(ctx.balance, ctx.riskPct, tool.entry, tool.sl, ctx.contract ?? undefined).qty)}`;
    } catch {
      return `${head} · qty —`;
    }
  }
  if (level === 'sl') return `SL ${fmt(tool.sl)} · ${signed(tool.sl - tool.entry)} · −1R`;
  const r = rMultiple(tool);
  return tool.tp === null ? '' : `TP ${fmt(tool.tp)} · ${signed(tool.tp - tool.entry)} · ${r === null ? '—' : r.toFixed(2)}R`;
}

/**
 * A live order's labels (T-023): its own qty, and each level's R from its own 1R (`riskAmountCcy`)
 * — `dir × (level − entry) × qty / 1R` — so a fill that paid the spread shows the R it really has.
 */
function liveLabel(
  tool: PositionToolState,
  order: { qty: number; riskAmount: number },
  level: 'entry' | 'sl' | 'tp',
  fmt: (p: number) => string,
  signed: (d: number) => string,
): string {
  const dir = tool.side === 'long' ? 1 : -1;
  const r = (price: number) => {
    const v = order.riskAmount > 0 ? (dir * (price - tool.entry) * order.qty) / order.riskAmount : 0;
    return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}R`;
  };
  if (level === 'entry') return `${tool.side === 'long' ? 'Long' : 'Short'} ${tool.kind === 'pending' ? 'limit' : 'position'} ${fmt(tool.entry)} · qty ${formatQty(order.qty)}`;
  if (level === 'sl') return `SL ${fmt(tool.sl)} · ${signed(tool.sl - tool.entry)} · ${r(tool.sl)}`;
  return tool.tp === null ? '' : `TP ${fmt(tool.tp)} · ${signed(tool.tp - tool.entry)} · ${r(tool.tp)}`;
}

/**
 * Which parts of a tool can be dragged: a draft all of them; a live order its stop and target
 * (T-033: dropping one is a server `modify`, decision 23), never its entry; a read-only drawing
 * (view-only, §9.3) nothing.
 */
export function draggableParts(tool: PositionToolState): readonly PositionToolPart[] {
  if (tool.readOnly) return [];
  return tool.kind === 'draft' ? ['entry', 'sl', 'tp', 'body', 'end'] : ['sl', 'tp'];
}

export interface ToolHandle {
  part: 'entry' | 'sl' | 'tp' | 'end';
  x: number;
  y: number;
}

/** Where one tool sits on screen: its left edge, each level's y, and its square handles. */
/** BUG-018: a new draft spans this many bars of the panel's timeframe until its end handle is dragged. */
export const DEFAULT_DRAFT_WIDTH_BARS = 20;
/** BUG-018: a live tool is drawn at least this wide, so a just-placed order's handles and ✕ fit. */
export const MIN_LIVE_WIDTH_PX = 48;

export interface ToolGeometry {
  toolId: string;
  x: number;
  /** BUG-018: the painted right end — the tool's own end, clipped to the pane. */
  xEnd: number;
  yEntry: number;
  ySl: number;
  yTp: number | null;
  handles: ToolHandle[];
  /** BUG-017: where a live order's ✕ sits (its cancel / close); null on drafts and read-only tools. */
  remove: { x: number; y: number } | null;
}

/** The ✕'s centre, this far left of the pane's right edge on the entry line. */
export const REMOVE_INSET_PX = 10;
/** Half the ✕'s clickable box. */
export const REMOVE_HALF_PX = 5;

/** How far right of the tool's left edge the handles sit, in px. */
export const HANDLE_OFFSET_PX = 12;

/**
 * Screen geometry of `tool`, or null when its levels are off the price scale. `xStart` is the
 * tool's left edge (its anchor time, clamped to the pane by the caller). A handle per draggable
 * part: three on a draft, stop and target on a live order, none on a read-only drawing.
 */
export function toolGeometry(
  tool: PositionToolState,
  xStart: number,
  priceToY: (price: number) => number | null,
  paneWidth = Number.POSITIVE_INFINITY,
  xRight = paneWidth,
): ToolGeometry | null {
  const yEntry = priceToY(tool.entry);
  const ySl = priceToY(tool.sl);
  if (yEntry === null || ySl === null) return null;
  const yTp = tool.tp === null ? null : priceToY(tool.tp);
  // BUG-018: the tool ends at its own right edge (a live one at least MIN_LIVE_WIDTH_PX wide), painted up to the pane's
  const right = Math.max(xRight, xStart + (tool.kind === 'draft' ? 1 : MIN_LIVE_WIDTH_PX));
  const xEnd = Math.min(right, paneWidth);
  // T-050: handles stay inside what is drawn, even on a narrow tool
  const x = Math.min(xStart + HANDLE_OFFSET_PX, xEnd - HANDLE_OFFSET_PX);
  const handles: ToolHandle[] = [];
  const parts = draggableParts(tool);
  if (parts.includes('entry')) handles.push({ part: 'entry', x, y: yEntry });
  if (parts.includes('sl')) handles.push({ part: 'sl', x, y: ySl });
  if (parts.includes('tp') && yTp !== null) handles.push({ part: 'tp', x, y: yTp });
  // BUG-018: a draft's width handle, on its right edge (only while that edge is on screen)
  if (parts.includes('end') && Number.isFinite(right) && right <= paneWidth) handles.push({ part: 'end', x: right, y: yEntry });
  const removable = tool.kind !== 'draft' && !tool.readOnly && Number.isFinite(xEnd);
  const remove = removable ? { x: xEnd - REMOVE_INSET_PX, y: yEntry } : null;
  return { toolId: tool.id, x: xStart, xEnd, yEntry, ySl, yTp, handles, remove };
}

export interface HitTarget {
  toolId: string;
  part: PositionToolPart;
  /** `remove`: a live order's ✕ (BUG-017; its part is `entry`, never dragged). */
  kind: 'handle' | 'line' | 'remove';
}

/**
 * What the pointer at (px, py) grabs, within `tolerancePx` (6 px, §9.1). A handle beats a line;
 * among equals the nearest wins, and on a tie the tool drawn last (on top). A line counts from the
 * tool's left edge rightwards. The entry line of a draft grabs the whole tool (`body`); the entry
 * line of a live order only activates it (`entry`, which the controller does not drag).
 */
export function hitTest(px: number, py: number, geometries: readonly ToolGeometry[], kinds: ReadonlyMap<string, PositionToolState['kind']>, tolerancePx = 6): HitTarget | null {
  let best: { target: HitTarget; distance: number; rank: number } | null = null;
  const consider = (target: HitTarget, distance: number, rank: number) => {
    if (!best || rank < best.rank || (rank === best.rank && distance <= best.distance)) best = { target, distance, rank };
  };
  for (const g of geometries) {
    if (g.remove && Math.abs(px - g.remove.x) <= REMOVE_HALF_PX + 2 && Math.abs(py - g.remove.y) <= REMOVE_HALF_PX + 2) {
      consider({ toolId: g.toolId, part: 'entry', kind: 'remove' }, Math.hypot(px - g.remove.x, py - g.remove.y), 0);
    }
    for (const h of g.handles) {
      if (Math.abs(px - h.x) <= tolerancePx && Math.abs(py - h.y) <= tolerancePx) {
        consider({ toolId: g.toolId, part: h.part, kind: 'handle' }, Math.hypot(px - h.x, py - h.y), 0);
      }
    }
    if (px < g.x - tolerancePx || px > g.xEnd + tolerancePx) continue; // BUG-018: a line is only as long as its tool
    const lines: [PositionToolPart, number | null][] = [
      [kinds.get(g.toolId) === 'draft' ? 'body' : 'entry', g.yEntry],
      ['sl', g.ySl],
      ['tp', g.yTp],
    ];
    for (const [part, y] of lines) {
      if (y !== null && Math.abs(py - y) <= tolerancePx) consider({ toolId: g.toolId, part, kind: 'line' }, Math.abs(py - y), 1);
    }
  }
  return best === null ? null : (best as { target: HitTarget }).target;
}

/**
 * T-049 (the user's feedback, item 15): only a draft shows its risk / reward zones. Once the order
 * exists (pending or open) the tool is its entry, SL and TP lines with their labels and handles —
 * no red/green fill over the chart it is trading.
 */
export function showsZones(tool: Pick<PositionToolState, 'kind'>): boolean {
  return tool.kind === 'draft';
}

/** BUG-018: a draft's width in whole bars when its right edge is dragged to `x` (at least one bar). */
export function widthBarsAt(x: number, xStart: number, barSpacing: number): number {
  return barSpacing > 0 ? Math.max(1, Math.round((x - xStart) / barSpacing)) : DEFAULT_DRAFT_WIDTH_BARS;
}

export type DragResult = { tool: PositionToolState } | { hint: string };

export interface DragInput {
  /** The tool as it was when the drag started. */
  original: PositionToolState;
  part: PositionToolPart;
  /** The price under the pointer now, and where the drag started (for `body`). */
  price: number;
  grabPrice: number;
  lastClose: number;
  precision: number;
  /** Within this price distance of the last close the entry snaps to it: `market`. */
  marketSnap: number;
}

/**
 * One drag step (§9.1, decision 29). Prices snap to `precision`.
 * - `sl` / `tp`: the level follows the pointer but must stay on its side of the entry.
 * - `entry` (drafts): the entry follows the pointer; at the last close (within `marketSnap`) it is
 *   `market` and sits exactly on it, on the favourable side it is a `limit`, and past the last
 *   close (a stop-entry, not in v1 — design §13) the move is refused with a hint. The entry may
 *   not cross its own stop or target.
 * - `body` (drafts): the whole tool moves by the pointer's travel, under the same entry rules;
 *   stop and target keep their distances.
 * A refused step returns a hint and the caller keeps the previous state.
 */
export function applyDrag(input: DragInput): DragResult {
  const { original: t, part, precision } = input;
  const p = snapPrice(input.price, precision);
  const long = t.side === 'long';
  if ((part === 'sl' || part === 'tp') && t.kind !== 'draft') {
    // T-033: the server's own rule (replay-core), so a drag into the market is a hint, never a request
    const hint = modifyHint(t, part === 'sl' ? { sl: p } : { tp: p }, input.lastClose);
    return hint ? { hint } : { tool: { ...t, [part]: p } };
  }
  if (part === 'sl') {
    if (long ? p >= t.entry : p <= t.entry) return { hint: `A ${t.side} stop must stay ${long ? 'below' : 'above'} the entry.` };
    return { tool: { ...t, sl: p } };
  }
  if (part === 'tp') {
    if (long ? p <= t.entry : p >= t.entry) return { hint: `A ${t.side} target must stay ${long ? 'above' : 'below'} the entry.` };
    return { tool: { ...t, tp: p } };
  }
  if (t.kind !== 'draft') return { tool: t };

  const shiftAll = part === 'body';
  const wanted = shiftAll ? snapPrice(t.entry + (input.price - input.grabPrice), precision) : p;
  const lastClose = snapPrice(input.lastClose, precision);
  let entry: number;
  let mode: PositionToolState['mode'];
  if (Math.abs(wanted - lastClose) <= input.marketSnap) {
    entry = lastClose;
    mode = 'market';
  } else if (long ? wanted < lastClose : wanted > lastClose) {
    entry = wanted;
    mode = 'limit';
  } else {
    return { hint: `Stop entries are not supported: a ${t.side} entry must be at or ${long ? 'below' : 'above'} the last close.` };
  }
  if (shiftAll) {
    const shift = entry - t.entry;
    return {
      tool: { ...t, entry, mode, sl: snapPrice(t.sl + shift, precision), tp: t.tp === null ? null : snapPrice(t.tp + shift, precision) },
    };
  }
  if (long ? entry <= t.sl : entry >= t.sl) return { hint: 'The entry cannot cross its stop.' };
  if (t.tp !== null && (long ? entry >= t.tp : entry <= t.tp)) return { hint: 'The entry cannot cross its target.' };
  return { tool: { ...t, entry, mode } };
}

/**
 * T-033: why moving a live order's stop or target to `levels` would be refused, as a hint, or null.
 * replay-core's `modifyLevelError` — the check the server applies to the PATCH: a pending order
 * against its limit (the tool's entry), a position against the last close.
 */
export function modifyHint(tool: PositionToolState, levels: { sl?: number; tp?: number }, lastClose: number): string | null {
  const order = { side: tool.side, status: tool.kind === 'pending' ? 'pending' : 'open', limitPrice: tool.entry } as const;
  const code = modifyLevelError(order, levels, lastClose);
  if (!code) return null;
  const against = tool.kind === 'pending' ? 'the limit' : 'the last close';
  const long = tool.side === 'long';
  if (code === 'TP_ON_WRONG_SIDE') return `A ${tool.side} target must stay ${long ? 'above' : 'below'} ${against}.`;
  if (code === 'SL_ON_WRONG_SIDE') return `A ${tool.side} stop must stay ${long ? 'below' : 'above'} ${against}.`;
  return `The stop is too close to ${against}.`;
}

import type { ContractSpec } from '@trade-automation/contracts';
/**
 * backtest-app-system-design.md §9.1 — the position tool's state and its change events, shared by
 * the primitive, the pointer controller and `core/replay/position-tools.store.ts`.
 */

export type PositionToolSide = 'long' | 'short';
export type PositionToolMode = 'market' | 'limit';
/** draft = not yet an order; pending / position = live order rows (T-023). */
export type PositionToolKind = 'draft' | 'pending' | 'position';
/** A level of the tool that can be dragged; `body` moves the whole draft; `end` resizes a draft (BUG-018). */
export type PositionToolPart = 'entry' | 'sl' | 'tp' | 'body' | 'end';

export interface PositionToolState {
  id: string;
  side: PositionToolSide;
  mode: PositionToolMode;
  entry: number;
  sl: number;
  tp: number | null;
  kind: PositionToolKind;
  orderId?: string;
  active: boolean;
  /** Where the drawing starts on the time axis (ms): a bar open of the panel's timeframe. */
  anchorTime: number;
  /**
   * A live order's own size and 1R (T-023): its labels show these, never a size re-derived from
   * the current balance and risk % (that is only right for a draft).
   */
  order?: { qty: number; riskAmount: number };
  /** §9.3 view-only: drawn, never editable — no handles, nothing draggable. */
  readOnly?: boolean;
  /** BUG-018: a draft's width in bars of the panel's timeframe (default 20) — visual only, never sent. */
  widthBars?: number;
  /**
   * BUG-018: where a live tool ends on the time axis (ms) — the cursor's bar for a pending order or a
   * position (it grows with each step), the exit bar for a closed trade in view-only.
   */
  endTime?: number;
}

/** What the chart needs to draw and label the tools of one panel. */
export interface PositionToolsView {
  tools: readonly PositionToolState[];
  /** Session balance and default risk %, for the qty and R labels (replay-core `positionSize`). */
  balance: number;
  riskPct: number;
  pricePrecision: number;
  /** T-054: the panel instrument's venue contract, so a draft's qty label is on the venue step (D12). */
  contract?: ContractSpec | null;
}

/** Emitted by the controller; the panel's store applies it. */
export type PositionToolChange =
  | { type: 'activate'; id: string }
  | { type: 'update'; tool: PositionToolState; final: boolean }
  | { type: 'hint'; message: string }
  /** BUG-017: the ✕ on a live order's tool — its cancel / close, after the user confirms. */
  | { type: 'remove'; id: string };

/**
 * backtest-app-system-design.md §9.1 — the position tool's state and its change events, shared by
 * the primitive, the pointer controller and `core/replay/position-tools.store.ts`.
 */

export type PositionToolSide = 'long' | 'short';
export type PositionToolMode = 'market' | 'limit';
/** draft = not yet an order; pending / position = live order rows (T-023). */
export type PositionToolKind = 'draft' | 'pending' | 'position';
/** A level of the tool that can be dragged; `body` moves the whole draft. */
export type PositionToolPart = 'entry' | 'sl' | 'tp' | 'body';

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
  /** Where the drawing starts on the time axis (ms): the cursor when the tool was created. */
  anchorTime: number;
}

/** What the chart needs to draw and label the tools of one panel. */
export interface PositionToolsView {
  tools: readonly PositionToolState[];
  /** Session balance and default risk %, for the qty and R labels (replay-core `positionSize`). */
  balance: number;
  riskPct: number;
  pricePrecision: number;
}

/** Emitted by the controller; the panel's store applies it. */
export type PositionToolChange =
  | { type: 'activate'; id: string }
  | { type: 'update'; tool: PositionToolState; final: boolean }
  | { type: 'hint'; message: string };

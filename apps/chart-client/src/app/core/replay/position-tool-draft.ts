import type { PositionToolSide, PositionToolState } from '../../features/chart/overlay/position-tool.model';
import { snapPrice } from '../../features/chart/overlay/position-tool.geometry';

/** Fallback stop: 0.5 % of price on the adverse side, when ATR(14) is not available yet (design §9.1). */
export const DEFAULT_STOP_FRACTION = 0.005;
/** Default target: 2R. */
export const DEFAULT_TARGET_R = 2;

export interface DraftInput {
  id: string;
  side: PositionToolSide;
  /** The crosshair price, or the last close when the pointer is off-chart. */
  price: number;
  lastClose: number;
  precision: number;
  anchorTime: number;
  /** ATR(14) of the panel's timeframe (T-028): the stop distance when set; else the 0.5 % fallback. */
  atr?: number | null;
}

/**
 * A new draft (§9.1, decision 29): entry at `price`, snapped to `precision` — `market` on the last
 * close, a `limit` on its favourable side. A price on the other side would be a stop-entry, which
 * v1 does not have (design §13): the draft then starts at the last close as `market`, with a hint.
 * Stop at 1 × ATR(14) on the adverse side (T-028), or 0.5 % of the entry before ATR is defined — at
 * least one tick away either way — and target at 2R. The new draft is active.
 */
export function createDraft(input: DraftInput): { tool: PositionToolState; hint?: string } {
  const { side, precision } = input;
  const long = side === 'long';
  const lastClose = snapPrice(input.lastClose, precision);
  const wanted = snapPrice(input.price, precision);
  let entry = wanted;
  let mode: PositionToolState['mode'] = 'limit';
  let hint: string | undefined;
  if (wanted === lastClose) {
    mode = 'market';
  } else if (long ? wanted > lastClose : wanted < lastClose) {
    entry = lastClose;
    mode = 'market';
    hint = `Stop entries are not supported: the ${side} draft starts at the last close.`;
  }
  const tick = 10 ** -precision;
  const raw = input.atr != null && Number.isFinite(input.atr) && input.atr > 0 ? input.atr : entry * DEFAULT_STOP_FRACTION;
  const distance = Math.max(tick, snapPrice(raw, precision));
  const sl = snapPrice(long ? entry - distance : entry + distance, precision);
  const tp = snapPrice(long ? entry + DEFAULT_TARGET_R * distance : entry - DEFAULT_TARGET_R * distance, precision);
  return { tool: { id: input.id, side, mode, entry, sl, tp, kind: 'draft', active: true, anchorTime: input.anchorTime }, hint };
}

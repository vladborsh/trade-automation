import { LEVEL_BAR_SEC, LEVEL_KIND_SIDE, type LevelBar, type LevelEvent, type LevelKind, type LevelStateSide } from '@trade-automation/contracts';

/**
 * IB-126 (architecture/alerts-liq-funding-levels-design-2026-11-05.md §4, P3, P7, P10) — one 15m bar against one level,
 * as a pure function. The loop, the seed and the history run (IB-127) all step through this, so "as live does" is one
 * piece of code.
 *
 * P3, with a close exactly at L counted as a touch (no event) and a high/low exactly at L not "beyond":
 * - **breakout up:** `close > L`, previous close `≤ L`; **breakout down** mirrors it;
 * - **sweep above:** `high > L`, `close < L`, previous close `≤ L`; **sweep below** mirrors it;
 * - **crossunder** (high levels): `close < L` and the period's last non-touch close was ABOVE L (P10's `lastSide`);
 *   **crossover** (low levels) mirrors it. The one shape that also passes the sweep test (previous close exactly at L,
 *   an earlier close above, a wick above and a close below) is a crossunder, the more specific fact.
 * An open whose previous close was exactly at L can pass a breakout and the opposite sweep at once; it is the breakout.
 * High levels are evaluated from below, low levels from above, an open from both sides without crossunder/crossover.
 *
 * P10: `lastSide` moves on every non-touch close; `firstBeyondAt` is the close moment of the period's first close
 * beyond L (above a high level, below a low one). Only high and low levels have state; an open never needs it.
 */
export interface LevelState {
  lastSide: LevelStateSide | null;
  /** Epoch ms: the close moment of the first close beyond L in the period; null = none yet. */
  firstBeyondAtMs: number | null;
  /** Epoch ms: the OPEN of the last bar this state has seen (the cursor). */
  lastBarMs: number;
}

/** P7 `touch`: came within `band` of L from one side without going beyond. */
export interface LevelTouch { from: 'below' | 'above'; distance: number }

export interface LevelStepResult {
  /** The events this bar produced, before the admin's per-event switches. At most one per event name. */
  events: LevelEvent[];
  /** The state after this bar; null for an open (no state) or when the state is unknown (unseeded). */
  state: LevelState | null;
  touch: LevelTouch | null;
}

const BAR_MS = LEVEL_BAR_SEC * 1_000;

/** Whether a kind keeps P10 state (a high or a low level). */
export const hasState = (kind: LevelKind): boolean => LEVEL_KIND_SIDE[kind] !== 'open';

/** An empty state at a period's start: nothing seen yet, the cursor on the bar before its first. */
export const freshState = (periodStartMs: number): LevelState => ({ lastSide: null, firstBeyondAtMs: null, lastBarMs: periodStartMs - BAR_MS });

/**
 * One bar. `state` is the level's P10 state before it: null means UNKNOWN (an unseeded high/low level, or an open),
 * and then crossunder/crossover cannot fire and no state comes out. Breakouts and sweeps need only `prevClose`.
 */
export function levelStep(
  kind: LevelKind, price: number, bar: LevelBar, prevClose: number, state: LevelState | null, touchBand: number,
): LevelStepResult {
  return levelStepFrom(LEVEL_KIND_SIDE[kind], price, bar, prevClose, state, touchBand);
}

/**
 * The same step by SIDE rather than kind. IB-128 (P9): a custom level is stepped as an open (`'open'`, no state):
 * both breakouts and both sweeps, no crossunder/crossover.
 */
export function levelStepFrom(
  side: 'high' | 'low' | 'open', price: number, bar: LevelBar, prevClose: number, state: LevelState | null, touchBand: number,
): LevelStepResult {
  const L = price;
  const { high, low, close } = bar;
  const events: LevelEvent[] = [];
  const fromBelow = side === 'high' || side === 'open';
  const fromAbove = side === 'low' || side === 'open';

  const breakoutUp = fromBelow && close > L && prevClose <= L;
  const breakoutDown = fromAbove && close < L && prevClose >= L;
  if (breakoutUp) events.push('breakout_up');
  if (breakoutDown) events.push('breakout_down');
  if (side === 'high' && state !== null && close < L && state.lastSide === 'above') events.push('crossunder');
  else if (fromBelow && !breakoutDown && high > L && close < L && prevClose <= L) events.push('sweep_above');
  if (side === 'low' && state !== null && close > L && state.lastSide === 'below') events.push('crossover');
  else if (fromAbove && !breakoutUp && low < L && close > L && prevClose >= L) events.push('sweep_below');

  let next: LevelState | null = null;
  if (side !== 'open' && state !== null) {
    const closeMs = bar.openMs + BAR_MS;
    const lastSide: LevelStateSide | null = close > L ? 'above' : close < L ? 'below' : state.lastSide;
    const beyond = side === 'high' ? close > L : close < L;
    next = { lastSide, firstBeyondAtMs: state.firstBeyondAtMs ?? (beyond ? closeMs : null), lastBarMs: bar.openMs };
  }

  return { events, state: next, touch: touchOf(L, bar, touchBand) };
}

/** P7: the bar stayed on one side (its extreme on L's near side at most AT L) and came within `band` of it. */
export function touchOf(L: number, bar: Pick<LevelBar, 'high' | 'low'>, band: number): LevelTouch | null {
  if (bar.high <= L) {
    const distance = (L - bar.high) / L;
    return distance <= band ? { from: 'below', distance } : null;
  }
  if (bar.low >= L) {
    const distance = (bar.low - L) / L;
    return distance <= band ? { from: 'above', distance } : null;
  }
  return null;
}

/**
 * P10 seed: the state a period's bars lead to, stepping through them as the live loop would. `bars` are the period's
 * 15m bars from its first, oldest first; bars before the period are ignored.
 */
export function seedState(kind: LevelKind, price: number, periodStartMs: number, bars: readonly LevelBar[]): LevelState {
  let state = freshState(periodStartMs);
  let prev: number | null = null;
  for (const bar of bars) {
    if (bar.openMs < periodStartMs) { prev = bar.close; continue; }
    state = levelStep(kind, price, bar, prev ?? bar.open, state, 1).state ?? state;
    prev = bar.close;
  }
  return state;
}

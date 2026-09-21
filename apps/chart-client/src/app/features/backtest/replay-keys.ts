import type { Timeframe } from '@trade-automation/contracts';

const ORDER: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

export type ReplayKeyAction = 'step' | 'finer' | 'coarser' | 'long' | 'short' | 'cancel' | 'order';

/**
 * Brief decision 37b hotkeys for the workspace: `→` steps, `[` / `]` switch to the next finer /
 * coarser timeframe, `B` / `S` place a long / short position tool, `Esc` removes the active draft,
 * `Enter` opens an order from the active tool (T-023; with none, a hint only). Ignored while the
 * user types in a form control, and with a modifier held (so browser and OS shortcuts keep working).
 */
export function replayKeyAction(event: Pick<KeyboardEvent, 'key' | 'target' | 'altKey' | 'ctrlKey' | 'metaKey'>): ReplayKeyAction | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  const target = event.target as { tagName?: string; isContentEditable?: boolean } | null;
  if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName ?? '') || target.isContentEditable)) return null;
  switch (event.key) {
    case 'ArrowRight':
      return 'step';
    case '[':
      return 'finer';
    case ']':
      return 'coarser';
    case 'b':
    case 'B':
      return 'long';
    case 's':
    case 'S':
      return 'short';
    case 'Escape':
      return 'cancel';
    case 'Enter':
      return 'order';
    default:
      return null;
  }
}

/**
 * Whether a hotkey may act in the workspace's current mode. A complete session is inert
 * (decision 28). Viewing the past (§9.3) allows only the timeframe keys — never a step, a tool
 * or an order (decision 32) — and there the timeframe works even on a complete session.
 */
export function keyAllowed(action: ReplayKeyAction, mode: { completed: boolean; viewOnly: boolean }): boolean {
  if (action === 'finer' || action === 'coarser') return mode.viewOnly || !mode.completed;
  return !mode.viewOnly && !mode.completed;
}

/** The neighbouring timeframe, clamped at 1m and 1d. */
export function adjacentTimeframe(tf: Timeframe, direction: 'finer' | 'coarser'): Timeframe {
  const i = ORDER.indexOf(tf);
  return ORDER[Math.min(ORDER.length - 1, Math.max(0, i + (direction === 'coarser' ? 1 : -1)))];
}

export const REPLAY_TIMEFRAMES: readonly Timeframe[] = ORDER;

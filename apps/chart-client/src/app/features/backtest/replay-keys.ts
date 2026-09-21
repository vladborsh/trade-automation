import type { Timeframe } from '@trade-automation/contracts';

const ORDER: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

export type ReplayKeyAction = 'step' | 'finer' | 'coarser';

/**
 * Brief decision 37b hotkeys for the workspace: `→` steps, `[` / `]` switch to the next finer /
 * coarser timeframe. Ignored while the user types in a form control, and with a modifier held
 * (so browser and OS shortcuts keep working).
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
    default:
      return null;
  }
}

/** The neighbouring timeframe, clamped at 1m and 1d. */
export function adjacentTimeframe(tf: Timeframe, direction: 'finer' | 'coarser'): Timeframe {
  const i = ORDER.indexOf(tf);
  return ORDER[Math.min(ORDER.length - 1, Math.max(0, i + (direction === 'coarser' ? 1 : -1)))];
}

export const REPLAY_TIMEFRAMES: readonly Timeframe[] = ORDER;

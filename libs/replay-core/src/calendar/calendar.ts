import { TIMEFRAME_MS, Timeframe } from '@trade-automation/contracts';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * architecture/backtest-app-system-design.md §5.1 — the close of the bar of `tf` containing
 * `cursorMs`: `floor(cursorMs / tfMs) * tfMs + tfMs`.
 */
export function barCloseAfter(cursorMs: number, tf: Timeframe): number {
  const tfMs = TIMEFRAME_MS[tf];
  return Math.floor(cursorMs / tfMs) * tfMs + tfMs;
}

/**
 * architecture/backtest-app-system-design.md §5.2 — the UTC interval [Saturday 00:00, Monday
 * 00:00). `Date#getUTCDay()`: 0 = Sunday, 6 = Saturday.
 */
export function isWeekend(ms: number): boolean {
  const day = new Date(ms).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * architecture/backtest-app-system-design.md §5.2 — the first bar opening Monday 00:00 UTC after
 * `ms`. Only meaningful for `ms` inside the weekend interval (`isWeekend(ms)`), which is its only
 * caller in `nextCursor`.
 */
export function mondayAfter(ms: number): number {
  const midnight = Math.floor(ms / DAY_MS) * DAY_MS;
  const day = new Date(midnight).getUTCDay();
  const daysUntilMonday = ((8 - day) % 7) || 7; // Sunday(0) -> 1, Saturday(6) -> 2
  return midnight + daysUntilMonday * DAY_MS;
}

/**
 * architecture/backtest-app-system-design.md §5.2 — verbatim pseudocode. `nextDataAt(fromMs)`
 * returns the earliest 1m `openTime >= fromMs` across any panel, or `null` if the tape is
 * exhausted; on the client it reads the ahead caches, the server does not need it (§5.5).
 */
export function nextCursor(
  cursorMs: number,
  tf: Timeframe,
  skipWeekends: boolean,
  nextDataAt: (fromMs: number) => number | null,
  periodToMs: number,
): number {
  const tfMs = TIMEFRAME_MS[tf];
  let b = barCloseAfter(cursorMs, tf); // close of the bar containing the cursor

  for (;;) {
    if (skipWeekends && isWeekend(b - tfMs)) {
      // bar opens inside [Sat 00:00, Mon 00:00) UTC
      b = mondayAfter(b - tfMs) + tfMs; // first bar opening Monday 00:00 UTC
    }
    const t = nextDataAt(b - tfMs);
    if (t === null) return periodToMs; // tape exhausted -> end of session
    if (t < b) return Math.min(b, periodToMs); // bar has data -> stop here
    b = Math.floor(t / tfMs) * tfMs + tfMs; // empty stretch -> jump to the bar that has data
  }
}

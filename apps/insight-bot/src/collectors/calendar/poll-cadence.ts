import { EconomicEvent } from '@trade-automation/contracts';

/**
 * architecture/economic-calendar.md §3.2 — when the next poll is due, as a pure function so the
 * cadence is unit-tested without timers. Lifted rule-for-rule from signal-server's
 * `CalendarIngestionService`, which is what IB-010 means by "as signal-server":
 *
 * - default `intervalMs` (600 000);
 * - `hotIntervalMs` (120 000) while a high-impact event sits within ±`HOT_WINDOW_MS` of now, and
 *   through the Sunday 03:00–07:00 UTC feed rollover (which covers ET midnight under both DST
 *   states);
 * - exponential back-off after consecutive errors, capped at 30 min;
 * - and a hard floor of 60 s between requests — the CDN caches for 60 s anyway.
 */
export const HOT_WINDOW_MS = 20 * 60_000;
export const HARD_POLL_FLOOR_MS = 60_000;
export const MAX_BACKOFF_MS = 30 * 60_000;

export interface PollCadenceConfig {
  intervalMs: number;
  hotIntervalMs: number;
}

export function isSundayRolloverWindow(now: number): boolean {
  const d = new Date(now);
  return d.getUTCDay() === 0 && d.getUTCHours() >= 3 && d.getUTCHours() < 7;
}

export function isHot(now: number, events: readonly EconomicEvent[]): boolean {
  if (isSundayRolloverWindow(now)) return true;
  return events.some(
    (e) =>
      e.impact === 'high' &&
      e.status !== 'removed' &&
      e.scheduledAt >= now - HOT_WINDOW_MS &&
      e.scheduledAt <= now + HOT_WINDOW_MS,
  );
}

export function currentIntervalMs(
  now: number,
  events: readonly EconomicEvent[],
  consecutiveErrors: number,
  config: PollCadenceConfig,
): number {
  const base = isHot(now, events) ? config.hotIntervalMs : config.intervalMs;
  const backoff =
    consecutiveErrors > 0 ? Math.min(HARD_POLL_FLOOR_MS * 2 ** consecutiveErrors, MAX_BACKOFF_MS) : 0;
  return Math.max(base, backoff, HARD_POLL_FLOOR_MS);
}

/** True when `now` is at or past the due time of the poll after `lastPolledAt`. */
export function isPollDue(
  now: number,
  lastPolledAt: number | null,
  events: readonly EconomicEvent[],
  consecutiveErrors: number,
  config: PollCadenceConfig,
): boolean {
  if (lastPolledAt === null) return true;
  return now - lastPolledAt >= currentIntervalMs(now, events, consecutiveErrors, config);
}

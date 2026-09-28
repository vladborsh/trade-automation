import { EconomicEvent } from '@trade-automation/contracts';
import {
  currentIntervalMs,
  HARD_POLL_FLOOR_MS,
  isHot,
  isPollDue,
  isSundayRolloverWindow,
  MAX_BACKOFF_MS,
} from '../../src/collectors/calendar/poll-cadence';

const CONFIG = { intervalMs: 600_000, hotIntervalMs: 120_000 };
// A Wednesday, well away from the Sunday rollover window.
const NOW = Date.UTC(2026, 8, 30, 12, 0);

function event(overrides: Partial<EconomicEvent> = {}): EconomicEvent {
  return {
    id: 'ff:1:2026-09-30', source: 'forexfactory', seriesId: '1', sourceUrl: null,
    title: 'CPI', country: 'USD', impact: 'high', scheduledAt: NOW, scheduledDay: '2026-09-30',
    forecast: null, previous: null, actual: null, actualSource: null, actualAt: null,
    status: 'scheduled', firstSeenAt: NOW, lastSeenAt: NOW, revision: 1,
    ...overrides,
  };
}

describe('poll cadence (architecture/economic-calendar.md §3.2, as signal-server)', () => {
  it('polls at the default interval when nothing is happening', () => {
    expect(currentIntervalMs(NOW, [], 0, CONFIG)).toBe(600_000);
  });

  it('goes hot within ±20 min of a high-impact event and cools outside it', () => {
    const near = event({ scheduledAt: NOW + 19 * 60_000 });
    const far = event({ scheduledAt: NOW + 21 * 60_000 });
    expect(currentIntervalMs(NOW, [near], 0, CONFIG)).toBe(120_000);
    expect(currentIntervalMs(NOW, [far], 0, CONFIG)).toBe(600_000);
    // and for the 20 minutes AFTER it fired, not only before
    expect(isHot(NOW, [event({ scheduledAt: NOW - 19 * 60_000 })])).toBe(true);
  });

  it('is not made hot by a low-impact or a cancelled event', () => {
    expect(isHot(NOW, [event({ impact: 'medium' })])).toBe(false);
    expect(isHot(NOW, [event({ status: 'removed' })])).toBe(false);
  });

  it('is hot through the Sunday 03:00–07:00 UTC feed rollover with no events at all', () => {
    const sunday05 = Date.UTC(2026, 8, 27, 5, 0);
    expect(new Date(sunday05).getUTCDay()).toBe(0);
    expect(isSundayRolloverWindow(sunday05)).toBe(true);
    expect(isSundayRolloverWindow(Date.UTC(2026, 8, 27, 2, 59))).toBe(false);
    expect(isSundayRolloverWindow(Date.UTC(2026, 8, 27, 7, 0))).toBe(false);
    expect(currentIntervalMs(sunday05, [], 0, CONFIG)).toBe(120_000);
  });

  it('backs off exponentially after errors, capped at 30 min', () => {
    expect(currentIntervalMs(NOW, [], 1, CONFIG)).toBe(600_000); // still under the default
    expect(currentIntervalMs(NOW, [], 5, CONFIG)).toBe(1_920_000 > MAX_BACKOFF_MS ? MAX_BACKOFF_MS : 1_920_000);
    expect(currentIntervalMs(NOW, [], 12, CONFIG)).toBe(MAX_BACKOFF_MS);
  });

  it('back-off beats the hot interval — a failing feed is not hammered every 2 min', () => {
    const near = event({ scheduledAt: NOW });
    expect(currentIntervalMs(NOW, [near], 4, CONFIG)).toBe(960_000);
  });

  it('never allows two requests closer than the 60 s floor, whatever the config says', () => {
    expect(currentIntervalMs(NOW, [], 0, { intervalMs: 1, hotIntervalMs: 1 })).toBe(HARD_POLL_FLOOR_MS);
  });

  it('polls immediately when it has never polled, then only when the interval has elapsed', () => {
    expect(isPollDue(NOW, null, [], 0, CONFIG)).toBe(true);
    expect(isPollDue(NOW, NOW - 599_999, [], 0, CONFIG)).toBe(false);
    expect(isPollDue(NOW, NOW - 600_000, [], 0, CONFIG)).toBe(true);
  });
});

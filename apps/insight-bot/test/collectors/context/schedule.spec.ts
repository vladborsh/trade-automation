import {
  COIN_REQUEST_SPACING_MS,
  COINS_DAILY_UTC,
  dueDailyTasks,
  FNG_DAILY_UTC,
  GLOBAL_POLL_MS,
  GLOBAL_RETRY_MS,
  globalDueAfter,
} from '../../../src/collectors/context/schedule';

const at = (h: number, m: number, day = 28) => new Date(Date.UTC(2026, 8, day, h, m));

describe('the /global cadence', () => {
  it('is 10 minutes — the resolution of a series that cannot be re-collected', () => {
    expect(GLOBAL_POLL_MS).toBe(10 * 60_000);
  });

  it('schedules the next slot 10 minutes on after a successful poll', () => {
    const t = Date.UTC(2026, 8, 28, 12, 0);
    expect(globalDueAfter(t, 'ok')).toBe(t + GLOBAL_POLL_MS);
  });

  it('RETRIES a failed poll in a minute instead of skipping the slot', () => {
    // The first live run lost its /global samples to a 429 because the clock was advanced before
    // the poll succeeded. For a forward-only series a skipped slot is gone for good.
    const t = Date.UTC(2026, 8, 28, 12, 0);
    expect(globalDueAfter(t, 'failed')).toBe(t + GLOBAL_RETRY_MS);
    expect(GLOBAL_RETRY_MS).toBeLessThan(GLOBAL_POLL_MS);
  });

  it('paces the per-coin calls inside the keyless allowance', () => {
    // 20 coins at this spacing is 10 requests/min, against CoinGecko's ~5-15/min.
    expect(COIN_REQUEST_SPACING_MS).toBe(6_000);
    expect(60_000 / COIN_REQUEST_SPACING_MS).toBeLessThanOrEqual(15);
  });
});

describe('the daily tasks', () => {
  it('runs Fear & Greed at 00:05 and the coins at 00:10 UTC', () => {
    expect(FNG_DAILY_UTC).toEqual({ hour: 0, minute: 5 });
    expect(COINS_DAILY_UTC).toEqual({ hour: 0, minute: 10 });
  });

  it('nothing is due before 00:05', () => {
    expect(dueDailyTasks(at(0, 4), '')).toEqual([]);
  });

  it('only Fear & Greed between 00:05 and 00:10, so the two do not spend the allowance at once', () => {
    expect(dueDailyTasks(at(0, 5), '')).toEqual(['fear-greed']);
    expect(dueDailyTasks(at(0, 9), '')).toEqual(['fear-greed']);
  });

  it('both from 00:10 onwards', () => {
    expect(dueDailyTasks(at(0, 10), '')).toEqual(['fear-greed', 'coins']);
    expect(dueDailyTasks(at(23, 59), '')).toEqual(['fear-greed', 'coins']);
  });

  it('nothing is due twice in the same UTC day', () => {
    expect(dueDailyTasks(at(12, 0), '2026-09-28')).toEqual([]);
  });

  it('a process down at 00:05 still collects that day when it starts at 03:00', () => {
    // These two series also show a missed day permanently, so catching up beats skipping.
    expect(dueDailyTasks(at(3, 0), '2026-09-27')).toEqual(['fear-greed', 'coins']);
  });

  it('becomes due again the next UTC day', () => {
    expect(dueDailyTasks(at(0, 10, 29), '2026-09-28')).toEqual(['fear-greed', 'coins']);
  });
});

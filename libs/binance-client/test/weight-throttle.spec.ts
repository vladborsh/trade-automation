import { DEFAULT_BUDGET_PER_MIN, DEFAULT_HEADER_CEILING, WeightThrottle } from '../src/archive/weight-throttle';

/**
 * IB-012 §5 / D15 — the backfill's REST throttle. A fake clock: the sleep advances it, so the
 * spec is instant and the waiting is observable.
 */
const fakeClock = (start = 1_000_000) => {
  let now = start;
  return {
    now: () => now,
    sleep: async (ms: number) => { now += ms; },
    advance: (ms: number) => { now += ms; },
    get value() { return now; },
  };
};

describe('WeightThrottle', () => {
  it('spends freely up to the 600/min budget', async () => {
    const clock = fakeClock();
    const t = new WeightThrottle({ now: clock.now, sleep: clock.sleep });
    expect(DEFAULT_BUDGET_PER_MIN).toBe(600);

    for (let i = 0; i < 60; i++) await t.acquire(10);
    expect(t.used()).toBe(600);
    expect(t.totalWaitedMs).toBe(0); // nothing waited: we stayed inside the budget
  });

  it('waits once the rolling minute is full, then continues', async () => {
    const clock = fakeClock();
    const t = new WeightThrottle({ now: clock.now, sleep: clock.sleep });
    const startedAt = clock.value;
    for (let i = 0; i < 61; i++) await t.acquire(10); // the 61st does not fit

    expect(clock.value - startedAt).toBeGreaterThanOrEqual(60_000);
    expect(t.totalWaitedMs).toBeGreaterThan(0);
    expect(t.used()).toBeLessThanOrEqual(600);
  });

  it('the window ROLLS: spend, wait a minute, spend again with no delay', async () => {
    const clock = fakeClock();
    const t = new WeightThrottle({ now: clock.now, sleep: clock.sleep });
    await t.acquire(600);
    clock.advance(60_001);
    expect(t.used()).toBe(0);
    await t.acquire(600);
    expect(t.totalWaitedMs).toBe(0);
  });

  it('the venue\'s own header outranks our tally: above 1200 we stop until the minute turns', async () => {
    const clock = fakeClock(1_000_000); // 1_000_000 % 60_000 = 40_000 into the minute
    const t = new WeightThrottle({ now: clock.now, sleep: clock.sleep });
    expect(DEFAULT_HEADER_CEILING).toBe(1200);

    t.observeHeader(1300); // another process on this IP is spending too
    const before = clock.value;
    await t.acquire(1);
    // slept to the next clock-minute boundary, because that is when Binance's counter resets
    expect(clock.value - before).toBe(20_000);
  });

  it('a header inside the ceiling changes nothing', async () => {
    const clock = fakeClock();
    const t = new WeightThrottle({ now: clock.now, sleep: clock.sleep });
    t.observeHeader(1199);
    await t.acquire(1);
    expect(t.totalWaitedMs).toBe(0);
  });

  it('ignores a missing or malformed header instead of stalling on it', async () => {
    const clock = fakeClock();
    const t = new WeightThrottle({ now: clock.now, sleep: clock.sleep });
    // /futures/data/* sends no weight header at all (IB-007)
    t.observeHeader(undefined);
    t.observeHeader(null);
    t.observeHeader(Number.NaN);
    await t.acquire(1);
    expect(t.totalWaitedMs).toBe(0);
  });
});

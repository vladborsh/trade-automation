import { BinanceWeightTracker } from '../../../src/venues/binance/binance-weight.tracker';

describe('BinanceWeightTracker', () => {
  it('sums this app\'s own calls over the trailing minute', () => {
    const tracker = new BinanceWeightTracker();
    tracker.recordCall(1, 1_000);
    tracker.recordCall(1, 2_000);
    tracker.recordCall(5, 3_000);
    expect(tracker.used1m(4_000)).toBe(7);
  });

  it('drops calls older than a minute', () => {
    const tracker = new BinanceWeightTracker();
    tracker.recordCall(10, 0);
    tracker.recordCall(3, 30_000);
    expect(tracker.used1m(30_500)).toBe(13);
    expect(tracker.used1m(61_000)).toBe(3); // the 10 has aged out
    expect(tracker.used1m(120_000)).toBe(0);
  });

  it('WD-011: keeps only the trailing minute even when nobody reads it', () => {
    // until WD-011 the daily report's peak sampling pruned this on every record, as a side effect;
    // without that, a box nobody scrapes would hold every call it ever made
    const tracker = new BinanceWeightTracker();
    for (let i = 0; i < 1_000; i++) tracker.recordCall(1, i * 30_000);
    expect((tracker as unknown as { calls: unknown[] }).calls.length).toBeLessThanOrEqual(2);
    expect(tracker.used1m(999 * 30_000)).toBe(2);
  });

  it('prefers the venue header while it is fresh, and falls back to the estimate after a minute', () => {
    // The /futures/data endpoints send no header (measured 2026-09-28), so a poller-only process
    // always reads the estimate; a /fapi call from another collector makes it authoritative.
    const tracker = new BinanceWeightTracker();
    tracker.recordCall(1, 1_000);
    expect(tracker.isEstimate(1_000)).toBe(true);

    tracker.recordHeader(300, 2_000);
    expect(tracker.used1m(2_500)).toBe(300);
    expect(tracker.isEstimate(2_500)).toBe(false);

    expect(tracker.used1m(70_000)).toBe(0); // header stale, and the call has aged out too
    expect(tracker.isEstimate(70_000)).toBe(true);
  });

  it('reads the header off a response, and shrugs at an absent or malformed one', () => {
    const tracker = new BinanceWeightTracker();
    const headers = (value: string | null) => ({ get: () => value });

    expect(tracker.recordFromHeaders(headers('42'), 1_000)).toBe(42);
    expect(tracker.used1m(1_000)).toBe(42);

    expect(tracker.recordFromHeaders(headers(null), 1_000)).toBeNull(); // /futures/data: no header
    expect(tracker.recordFromHeaders(headers('not-a-number'), 1_000)).toBeNull();
    expect(tracker.used1m(1_000)).toBe(42); // unchanged by either
  });

  it('refuses a negative weight, since that would understate the budget', () => {
    expect(() => new BinanceWeightTracker().recordCall(-1)).toThrow(/non-negative/);
  });

  it('holds the §4.5 steady-state figure: 5 calls x 30 symbols per 5 min = 30 weight/min', () => {
    const tracker = new BinanceWeightTracker();
    // One poll pass, then read the minute containing it.
    for (let i = 0; i < 5 * 30; i += 1) tracker.recordCall(1, 1_000);
    expect(tracker.used1m(2_000)).toBe(150); // per 5-minute pass
    expect(150 / 5).toBe(30); // per minute, §4.5's line
    expect((150 / 5 / 2400) * 100).toBeCloseTo(1.25, 2); // 1.25 % of the budget, D15
  });

  it('lets the /fapi header override the /futures/data estimate — one IP, one budget', () => {
    // IB-005's perp collector reports x-mbx-used-weight-1m from /fapi/*; IB-007's poller counts
    // its own /futures/data/* calls, which carry no header. Both feed this one tracker, and the
    // venue's own figure is the truthful one whenever it is fresh.
    const tracker = new BinanceWeightTracker();
    for (let i = 0; i < 150; i += 1) tracker.recordCall(1, 1_000); // a poller pass
    expect(tracker.used1m(1_500)).toBe(150);
    expect(tracker.isEstimate(1_500)).toBe(true);

    tracker.recordHeader(612, 2_000); // a /fapi answer: the venue's real number for this IP
    expect(tracker.used1m(2_500)).toBe(612);
    expect(tracker.isEstimate(2_500)).toBe(false);
  });
});

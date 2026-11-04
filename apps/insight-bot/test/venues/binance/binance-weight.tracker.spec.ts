import { BinanceWeightTracker } from '../../../src/venues/binance/binance-weight.tracker';
import { CALL_WEIGHT } from '../../../src/venues/binance/futures-data.client';

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

  it('IB-BUG-030: an OI/LS pass (5 x 30 /futures/data calls) costs 0 weight, header or not', () => {
    // «IP Weight 0» per Binance's docs, and measured (CALL_WEIGHT's comment). Until IB-BUG-030 the
    // pass was booked at 1 per call: the gauge read 150 without a header and the true 1-2 with one.
    const tracker = new BinanceWeightTracker();
    for (let i = 0; i < 5 * 30; i += 1) tracker.recordCall(CALL_WEIGHT, 1_000);
    expect(tracker.used1m(2_000)).toBe(0);
    tracker.recordHeader(2, 2_000); // a /fapi answer in the same minute
    expect(tracker.used1m(2_500)).toBe(2); // the IP's real figure, and no longer a flip from 150
  });

  it('lets the /fapi header override our own estimate — one IP, one budget', () => {
    // Our own count is a lower bound on OUR traffic (documented weights of /fapi calls we made);
    // the header is the venue's figure for the whole IP, the truthful one whenever it is fresh.
    const tracker = new BinanceWeightTracker();
    for (let i = 0; i < 150; i += 1) tracker.recordCall(1, 1_000); // e.g. 150 weight-1 /fapi reads
    expect(tracker.used1m(1_500)).toBe(150);
    expect(tracker.isEstimate(1_500)).toBe(true);

    tracker.recordHeader(612, 2_000); // a /fapi answer: the venue's real number for this IP
    expect(tracker.used1m(2_500)).toBe(612);
    expect(tracker.isEstimate(2_500)).toBe(false);
  });
});

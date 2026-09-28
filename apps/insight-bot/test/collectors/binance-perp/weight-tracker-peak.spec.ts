import { BinanceWeightTracker } from '../../../src/collectors/binance-perp/binance-weight.tracker';

/**
 * IB-011 — the daily report's "Binance weight high-water mark" (§6.2). Added to IB-007's tracker:
 * the peak is observed where the value can change, so a spike between two samples cannot hide.
 */
describe('BinanceWeightTracker.peak1m (IB-011)', () => {
  const T = Date.UTC(2026, 8, 28, 12, 0, 0);

  it('remembers the highest trailing-minute value, not the latest', () => {
    const tracker = new BinanceWeightTracker();
    tracker.recordCall(10, T);
    tracker.recordCall(50, T + 1_000); // 60 in the window
    expect(tracker.peak1m()).toBe(60);

    tracker.recordCall(1, T + 120_000); // the window has rolled: used1m is 1 again
    expect(tracker.used1m(T + 120_000)).toBe(1);
    expect(tracker.peak1m()).toBe(60); // …but the peak stands
  });

  it("the venue's header counts toward the peak too", () => {
    const tracker = new BinanceWeightTracker();
    tracker.recordHeader(1_800, T);
    expect(tracker.peak1m()).toBe(1_800);
  });

  it('resetPeak starts the next day at zero', () => {
    const tracker = new BinanceWeightTracker();
    tracker.recordCall(42, T);
    expect(tracker.peak1m()).toBe(42);
    tracker.resetPeak();
    expect(tracker.peak1m()).toBe(0);
  });
});

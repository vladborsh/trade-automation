import { MarkSampler, minuteBoundary } from '../../../src/collectors/binance-perp/mark-sampler';
import type { MarkPriceEvent } from '../../../src/collectors/binance-perp/payloads';

/** IB-005 — D5's one-row-per-minute sampling and §4.1's funding rollover, with no clock of its own. */

const T0 = Date.UTC(2026, 8, 28, 12, 0, 0);
const NEXT_FUNDING = Date.UTC(2026, 8, 28, 16, 0, 0);

const event = (symbol: string, at: number, over: Partial<MarkPriceEvent> = {}): MarkPriceEvent => ({
  e: 'markPriceUpdate', E: at, s: symbol, p: '100', i: '99.9', r: '0.0001', T: NEXT_FUNDING, ...over,
});

describe('MarkSampler (IB-005)', () => {
  it('writes one row per symbol per minute — the LAST sample, not the first', () => {
    const s = new MarkSampler();
    s.accept(event('BTCUSDT', T0 + 1_000, { p: '100' }));
    s.accept(event('BTCUSDT', T0 + 30_000, { p: '101' }));
    s.accept(event('BTCUSDT', T0 + 59_000, { p: '102.5' }));
    s.accept(event('ETHUSDT', T0 + 58_000, { p: '2500' }));

    const boundary = new Date(T0 + 60_000);
    const rows = s.sampleMinute(boundary);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.symbol, r.markPrice, r.ts.getTime()])).toEqual([
      ['BTCUSDT', 102.5, T0 + 60_000],
      ['ETHUSDT', 2500, T0 + 60_000],
    ]);
  });

  it('a symbol that sent nothing this minute leaves a hole — no stale row is re-stamped', () => {
    const s = new MarkSampler();
    s.accept(event('BTCUSDT', T0 + 10_000));
    expect(s.sampleMinute(new Date(T0 + 60_000))).toHaveLength(1);
    expect(s.sampleMinute(new Date(T0 + 120_000))).toEqual([]); // the gap report sees the hole
    expect(s.pendingSymbols).toBe(0);
  });

  it('a funding rollover reports the settled time and the last prediction, stamped at the settlement second', () => {
    const s = new MarkSampler();
    s.accept(event('BTCUSDT', NEXT_FUNDING - 2_000, { r: '0.00031000', T: NEXT_FUNDING }));
    expect(s.rollovers()).toEqual([]); // nothing yet

    // the venue rolls the interval forward: T moves to the next settlement
    s.accept(event('BTCUSDT', NEXT_FUNDING + 1_000, { r: '0.00005000', T: NEXT_FUNDING + 8 * 3_600_000 }));

    const [rollover] = s.rollovers();
    expect(rollover.symbol).toBe('BTCUSDT');
    expect(rollover.settledAt).toEqual(new Date(NEXT_FUNDING));
    // the LAST prediction before the settlement, kept at the exact settlement second (§4.1)
    expect(rollover.lastPrediction).toMatchObject({
      symbol: 'BTCUSDT', predictedFundingRate: 0.00031, ts: new Date(NEXT_FUNDING),
    });
    expect(s.rollovers()).toEqual([]); // drained
  });

  it('spots a rollover that straddles a minute boundary — settlements land exactly on the hour', () => {
    const s = new MarkSampler();
    // the last event of the minute BEFORE the settlement…
    s.accept(event('BTCUSDT', NEXT_FUNDING - 400, { r: '0.00029', T: NEXT_FUNDING }));
    expect(s.sampleMinute(new Date(NEXT_FUNDING))).toHaveLength(1); // the minute is written and closed
    // …and the first event after it, in the NEXT minute: the comparison must survive the boundary
    s.accept(event('BTCUSDT', NEXT_FUNDING + 600, { r: '0.00004', T: NEXT_FUNDING + 8 * 3_600_000 }));

    const [rollover] = s.rollovers();
    expect(rollover).toBeDefined();
    expect(rollover.settledAt).toEqual(new Date(NEXT_FUNDING));
    expect(rollover.lastPrediction.predictedFundingRate).toBe(0.00029);
  });

  it('a symbol silent for a minute is not re-written, but is still remembered for the rollover check', () => {
    const s = new MarkSampler();
    s.accept(event('BTCUSDT', T0 + 1_000, { T: NEXT_FUNDING }));
    expect(s.sampleMinute(new Date(T0 + 60_000))).toHaveLength(1);
    expect(s.sampleMinute(new Date(T0 + 120_000))).toEqual([]); // silent minute: no row
    s.accept(event('BTCUSDT', T0 + 130_000, { T: NEXT_FUNDING + 8 * 3_600_000 }));
    expect(s.rollovers()).toHaveLength(1); // …and the rollover is still noticed
  });

  it('does not invent a rollover on the first sample of a symbol, nor when T is unchanged', () => {
    const s = new MarkSampler();
    s.accept(event('SOLUSDT', T0));
    s.accept(event('SOLUSDT', T0 + 1_000));
    expect(s.rollovers()).toEqual([]);
  });

  it('rollovers are per symbol', () => {
    const s = new MarkSampler();
    s.accept(event('BTCUSDT', T0, { T: NEXT_FUNDING }));
    s.accept(event('ETHUSDT', T0, { T: NEXT_FUNDING }));
    s.accept(event('BTCUSDT', T0 + 1_000, { T: NEXT_FUNDING + 8 * 3_600_000 }));
    expect(s.rollovers().map((r) => r.symbol)).toEqual(['BTCUSDT']);
  });
});

describe('minuteBoundary', () => {
  it('floors to the start of the minute', () => {
    expect(minuteBoundary(T0 + 59_999).getTime()).toBe(T0);
    expect(minuteBoundary(T0 + 60_000).getTime()).toBe(T0 + 60_000);
  });
});

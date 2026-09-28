import type { BybitTickerData } from '../../../src/collectors/bybit/payloads';
import { TickerState } from '../../../src/collectors/bybit/ticker-state';
import { TICKER_DELTA, TICKER_SNAPSHOT } from './fixtures';

/**
 * IB-008 — the snapshot+delta merge and §3.3's volume rule: per-minute marks for the signal set,
 * settlement-only for the rest.
 */

const T0 = Date.UTC(2026, 8, 28, 12, 0, 0);
const NEXT_FUNDING = Date.UTC(2026, 8, 28, 16, 0, 0);
const signalSet = () => new Set(['BTCUSDT']);

const ticker = (symbol: string, over: Partial<BybitTickerData> = {}): BybitTickerData => ({
  symbol, markPrice: '100', indexPrice: '99.9', fundingRate: '0.0001', nextFundingTime: String(NEXT_FUNDING), ...over,
});

describe('TickerState — snapshot then delta (the live shape)', () => {
  it('a delta updates only what it carries; the mark price is NOT erased', () => {
    const state = new TickerState(signalSet());
    state.accept('BTCUSDT', TICKER_SNAPSHOT.data as BybitTickerData, 'snapshot');
    state.accept('BTCUSDT', TICKER_DELTA.data as BybitTickerData, 'delta'); // no markPrice, no fundingRate

    const [row] = state.sampleMinute(new Date(T0));
    expect(row.markPrice).toBe(82997.4); // from the snapshot
    expect(row.indexPrice).toBe(83032.8); // updated by the delta
    expect(row.predictedFundingRate).toBe(0.00005416); // still the snapshot's
  });

  it('a delta before any snapshot is taken as the base rather than dropped', () => {
    const state = new TickerState(signalSet());
    state.accept('BTCUSDT', { symbol: 'BTCUSDT', markPrice: '10' }, 'delta');
    expect(state.snapshotOf('BTCUSDT')).toEqual({ symbol: 'BTCUSDT', markPrice: '10' });
  });

  it('a later snapshot replaces the merged state instead of merging into it', () => {
    const state = new TickerState(signalSet());
    state.accept('BTCUSDT', ticker('BTCUSDT', { markPrice: '1', indexPrice: '2' }), 'snapshot');
    state.accept('BTCUSDT', { symbol: 'BTCUSDT', markPrice: '3' }, 'snapshot');
    expect(state.snapshotOf('BTCUSDT')).toEqual({ symbol: 'BTCUSDT', markPrice: '3' });
  });
});

describe('TickerState — §3.3 volume rule', () => {
  it('writes a per-minute row for the signal set only', () => {
    const state = new TickerState(signalSet());
    state.accept('BTCUSDT', ticker('BTCUSDT'), 'snapshot');
    state.accept('XRPUSDT', ticker('XRPUSDT'), 'snapshot');
    state.accept('DOGEUSDT', ticker('DOGEUSDT'), 'snapshot');

    const rows = state.sampleMinute(new Date(T0));
    expect(rows.map((r) => r.symbol)).toEqual(['BTCUSDT']);
    expect(state.trackedSymbols).toBe(3); // the others are tracked, just not written per minute
  });

  it('a signal-set symbol silent this minute gets no row', () => {
    const state = new TickerState(signalSet());
    state.accept('BTCUSDT', ticker('BTCUSDT'), 'snapshot');
    expect(state.sampleMinute(new Date(T0))).toHaveLength(1);
    expect(state.sampleMinute(new Date(T0 + 60_000))).toEqual([]);
  });

  it('EVERY symbol gets a row at its settlement — that is how the non-signal-set ones are stored', () => {
    const state = new TickerState(signalSet());
    state.accept('XRPUSDT', ticker('XRPUSDT', { fundingRate: '0.00031' }), 'snapshot');
    expect(state.rollovers()).toEqual([]);

    state.accept('XRPUSDT', ticker('XRPUSDT', { fundingRate: '0.00004', nextFundingTime: String(NEXT_FUNDING + 8 * 3_600_000) }), 'delta');

    const [rollover] = state.rollovers();
    expect(rollover.symbol).toBe('XRPUSDT');
    expect(rollover.settledAt).toEqual(new Date(NEXT_FUNDING));
    expect(rollover.lastPrediction).toMatchObject({ symbol: 'XRPUSDT', ts: new Date(NEXT_FUNDING), predictedFundingRate: 0.00031 });
    expect(state.rollovers()).toEqual([]); // drained
  });

  it('the rollover survives a minute boundary (settlements land on the hour)', () => {
    const state = new TickerState(signalSet());
    state.accept('BTCUSDT', ticker('BTCUSDT', { fundingRate: '0.00029' }), 'snapshot');
    state.sampleMinute(new Date(NEXT_FUNDING)); // the minute closes…
    state.accept('BTCUSDT', ticker('BTCUSDT', { nextFundingTime: String(NEXT_FUNDING + 8 * 3_600_000) }), 'delta');
    expect(state.rollovers()).toHaveLength(1); // …and the comparison still has its predecessor
  });

  it('does not invent a rollover on the first message, nor when nextFundingTime is unchanged', () => {
    const state = new TickerState(signalSet());
    state.accept('BTCUSDT', ticker('BTCUSDT'), 'snapshot');
    state.accept('BTCUSDT', ticker('BTCUSDT'), 'delta');
    expect(state.rollovers()).toEqual([]);
  });
});

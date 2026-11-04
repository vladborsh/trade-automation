import { describe, expect, it } from 'vitest';
import type { InsightApiClient } from '../../core/insight-api.client';
import { fetchWindow } from './instrument-window';

/**
 * IB-081 — `fetchWindow` used to keep only `oi.points` and drop what `/series/oi` said about where
 * the series begins. The stub's OI and long/short disagree on truncation, so a loader that copied
 * one onto the other, or dropped OI's, fails here.
 */
function api(over: Partial<Record<keyof InsightApiClient, unknown>> = {}): InsightApiClient {
  const empty = { symbol: 'BTCUSDT', downsampled: false };
  return {
    candles: async () => ({ ...empty, venue: 'binance', market: 'perp', timeframe: '1h', candles: [] }),
    openInterest: async () => ({ ...empty, venue: 'binance', points: [{ time: 2_000, value: 1, notional: null }], coverageFrom: 2_000, truncated: true }),
    funding: async () => ({ ...empty, settled: [], predicted: [], unavailable: ['okx'] }),
    longShort: async () => ({ ...empty, kind: 'global_account', points: [{ time: 1_000, ratio: 1 }] }),
    liquidations: async () => ({ ...empty, bucket: '1m', venue: 'all', venuesPresent: [], bars: [], undercounted: false }),
    liquidationEvents: async () => ({ symbol: 'BTCUSDT', minUsd: 0, events: [], venuesPresent: [], undercounted: false }),
    calendarEvents: async () => ({ events: [] }),
    ...over,
  } as unknown as InsightApiClient;
}

const req = { symbol: 'BTCUSDT', fromMs: 0, toMs: 3_600_000, timeframe: '1h' as const, bucket: '1m' };

describe('fetchWindow (IB-081)', () => {
  it('keeps where the OI series begins beside its points', async () => {
    const data = await fetchWindow(api(), req);
    expect(data.openInterest).toHaveLength(1);
    expect(data.openInterestCoverage).toEqual({ coverageFrom: 2_000, truncated: true });
  });

  it('a full OI read carries no truncation, and long/short and funding keep their own fields', async () => {
    const data = await fetchWindow(api({ openInterest: async () => ({ symbol: 'BTCUSDT', venue: 'binance', points: [], downsampled: false }) }), req);
    expect(data.openInterestCoverage?.truncated).toBeUndefined();
    expect(data.longShort.truncated).toBeUndefined();
    expect(data.funding.unavailable).toEqual(['okx']);
  });
});

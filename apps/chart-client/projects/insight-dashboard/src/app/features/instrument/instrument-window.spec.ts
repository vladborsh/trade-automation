import { describe, expect, it } from 'vitest';
import type { InsightApiClient } from '../../core/insight-api.client';
import { LEVELS_LOOKBACK_MAX_DAYS, fetchWindow, levelsFromMs } from './instrument-window';

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

describe('IB-129: the alert marks and the month lookback', () => {
  const DAY = 86_400_000;
  const mark = { type: 'liq', at: 1_000, side: 'long', sumUsd: 1, thresholdUsd: 1, byVenue: { binance: 1, bybit: 0, okx: 0 } };

  it('the marks are read for the WHOLE window, beside the rest', async () => {
    const asked: number[][] = [];
    const data = await fetchWindow(api({ alertMarks: async (_s: string, f: number, t: number) => { asked.push([f, t]); return { symbol: 'BTCUSDT', marks: [mark], truncated: false }; } }), req);
    expect(data.alertMarks).toEqual([mark]);
    expect(asked).toEqual([[req.fromMs, req.toMs]]);
  });

  it('a failed marks read is absent (no markers, no legend entries), not a failed window', async () => {
    const data = await fetchWindow(api({ alertMarks: async () => { throw new Error('503'); } }), req);
    expect(data.alertMarks).toBeUndefined();
    expect(data.candles).toBeDefined();
  });

  it('the daily candles start on the 1st of the month before the window\'s first month', async () => {
    const from = Date.UTC(2026, 10, 6, 7); // 6 Nov 2026
    expect(levelsFromMs(from)).toBe(Date.UTC(2026, 9, 1)); // 1 Oct: October is complete for November's PMH/PML
    const asked: number[] = [];
    await fetchWindow(api({ candles: async (_s: string, f: number, _t: number, tf: string) => { if (tf === '1d') asked.push(f); return { symbol: 'BTCUSDT', downsampled: false, venue: 'binance', market: 'perp', timeframe: tf, candles: [] }; } }), { ...req, fromMs: from, toMs: from + 3_600_000 });
    expect(asked).toEqual([Date.UTC(2026, 9, 1)]);
  });

  it('never less than the old 14 days (the first ISO week), and never more than LEVELS_LOOKBACK_MAX_DAYS', () => {
    expect(levelsFromMs(Date.UTC(2026, 10, 1, 0, 0, 1))).toBe(Date.UTC(2026, 9, 1)); // 1st of a month: 31 days back
    for (let d = 0; d < 800; d++) {
      const from = Date.UTC(2025, 0, 1) + d * DAY + 13 * 3_600_000;
      const back = (from - levelsFromMs(from)) / DAY;
      expect(back).toBeGreaterThanOrEqual(14);
      expect(back).toBeLessThanOrEqual(LEVELS_LOOKBACK_MAX_DAYS);
    }
  });
});

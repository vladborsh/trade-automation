import { signal } from '@angular/core';
import { vi } from 'vitest';
import type { WebTimeframe, WebTopLiquidation } from '@trade-automation/contracts';
import type { InsightApiClient } from '../../core/insight-api.client';
import { instrumentTailJobs } from './instrument-tail';
import type { PaneData } from './pane-data';

const candle = (time: number, close = 1) => ({ time, open: 1, high: 1, low: 1, close, volume: 1, takerBuyVolume: 1 });
const DAY = 86_400;
const NOW = Date.UTC(2026, 9, 29, 12, 7, 30);
const TODAY = Date.UTC(2026, 9, 29) / 1000;

function window(): PaneData {
  return {
    instrument: 'binance:BTCUSDT', timeframe: '1m', bucket: '1m',
    candles: { venue: 'binance', market: 'perp', symbol: 'BTCUSDT', timeframe: '1m', candles: [candle(NOW / 1000 - 90), candle(NOW / 1000 - 30, 5)], downsampled: false },
    openInterest: [], funding: { symbol: 'BTCUSDT', settled: [], predicted: [], downsampled: false },
    longShort: { symbol: 'BTCUSDT', kind: 'global_account', points: [], downsampled: false },
    liquidations: { symbol: 'BTCUSDT', bucket: '1m', venue: 'all', venuesPresent: [], bars: [], downsampled: false, undercounted: false },
    liquidationEvents: [], liquidationVenues: [], dailyCandles: [candle(TODAY - DAY), candle(TODAY)], calendarEvents: [],
  };
}

/** The bot, answering every read with one point at `NOW` and recording what was asked. */
function fakeApi() {
  const at = NOW / 1000;
  const api = {
    candles: vi.fn(async (_s: string, _f: number, _t: number, tf: string) => ({
      candles: tf === '1d' ? [candle(TODAY, 9)] : [candle(at - 30, 6), candle(at + 30, 7)],
    })),
    openInterest: vi.fn(async () => ({ points: [{ time: at, value: 1, notional: null }] })),
    funding: vi.fn(async () => ({ symbol: 'BTCUSDT', settled: [], predicted: [{ time: at, rate: 0.0001 }], downsampled: false })),
    longShort: vi.fn(async () => ({ symbol: 'BTCUSDT', kind: 'global_account', points: [{ time: at, ratio: 1.2 }], downsampled: false })),
    liquidations: vi.fn(async () => ({ symbol: 'BTCUSDT', bucket: '1m', venue: 'all', venuesPresent: ['binance'], bars: [{ time: at, long: 1, short: 0 }], downsampled: false, undercounted: false })),
    liquidationEvents: vi.fn(async () => ({ symbol: 'BTCUSDT', minUsd: 0, events: [{ time: at, side: 'long', usd: 1, price: 1, venue: 'binance' }], venuesPresent: ['binance'], undercounted: false })),
    topLiquidations: vi.fn(async () => ({ symbol: 'BTCUSDT', rows: [{ time: at } as WebTopLiquidation] })),
  };
  return api;
}

function setup() {
  const api = fakeApi();
  const page = {
    panes: signal<PaneData | null>(window()),
    top: signal<WebTopLiquidation[]>([]),
    symbol: signal('BTCUSDT'),
    timeframe: signal<WebTimeframe>('1m'),
    refreshSummary: vi.fn(),
  };
  const [candles, side] = instrumentTailJobs(api as unknown as InsightApiClient, page);
  return { api, page, candles, side };
}

describe('instrumentTailJobs (IB-066)', () => {
  it('the candle job reads from the last bar\'s open to now and joins the answer on', async () => {
    const { api, page, candles } = setup();
    const apply = await candles.read(NOW - 5_000, NOW);
    expect(api.candles).toHaveBeenCalledWith('BTCUSDT', NOW - 30_000, NOW, '1m', 'perp');
    expect(page.panes()!.candles.candles.map((c) => c.close)).toEqual([1, 5]); // nothing until applied
    apply();
    expect(page.panes()!.candles.candles.map((c) => [c.time - NOW / 1000, c.close])).toEqual([[-90, 1], [-30, 6], [30, 7]]);
    expect(page.panes()!.extendsLater).toBe(true);
  });

  it('the minute\'s job reads the database panes from the last bucket, the top table and the summary', async () => {
    const { api, page, side } = setup();
    const apply = await side.read(NOW - 60_000, NOW);
    const bucketStart = Math.floor((NOW - 60_000) / 60_000) * 60_000;
    expect(api.openInterest).toHaveBeenCalledWith('BTCUSDT', bucketStart, NOW);
    expect(api.liquidations).toHaveBeenCalledWith('BTCUSDT', bucketStart, NOW, '1m');
    expect(api.topLiquidations).toHaveBeenCalledWith('BTCUSDT', NOW - 86_400_000, NOW, 50);
    expect(api.candles).not.toHaveBeenCalled(); // same day: the daily candles are not re-read
    apply();
    const p = page.panes()!;
    expect(p.openInterest).toHaveLength(1);
    expect(p.liquidations.bars).toHaveLength(1);
    expect(p.liquidationEvents).toHaveLength(1);
    expect(p.longShort.points).toHaveLength(1);
    expect(page.top()).toHaveLength(1);
    expect(page.refreshSummary).toHaveBeenCalledWith('BTCUSDT');
  });

  it('after midnight the minute\'s job also re-reads the daily candles from the day that was forming', async () => {
    const { api, page, side } = setup();
    const after = Date.UTC(2026, 9, 30, 0, 0, 30);
    const apply = await side.read(after - 60_000, after);
    expect(api.candles).toHaveBeenCalledWith('BTCUSDT', TODAY * 1000, after, '1d', 'perp');
    apply();
    expect(page.panes()!.dailyCandles.map((c) => c.close)).toEqual([1, 9]);
  });
});

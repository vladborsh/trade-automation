import type { WebUniverseSummaryRow } from '@trade-automation/contracts';
import { nowTiles, settleTime } from './instrument-now';
import { timeOfDay } from '../../shared/time-format';
import type { PaneData } from './pane-data';

const candle = (time: number, volume: number, takerBuyVolume: number | null) =>
  ({ time, open: 1, high: 1, low: 1, close: 1, volume, takerBuyVolume });

/** A window whose latest points are deliberately NOT the last elements, so `latest` is tested. */
function pane(over: Partial<PaneData> = {}): PaneData {
  return {
    instrument: 'binance:BTCUSDT', timeframe: '1m', bucket: '5m',
    candles: { venue: 'binance', symbol: 'BTCUSDT', market: 'perp', timeframe: '1m', candles: [candle(60, 10, 8), candle(120, 10, 9)], downsampled: false } as never,
    openInterest: [{ time: 200, value: 95_026.888, notional: null }, { time: 100, value: 1, notional: null }],
    funding: { symbol: 'BTCUSDT', settled: [], predicted: [{ time: 300, rate: 0.0002 }, { time: 100, rate: 0.9 }], downsampled: false },
    longShort: { symbol: 'BTCUSDT', kind: 'global_account', points: [{ time: 50, ratio: 9 }, { time: 90, ratio: 2.0412 }], downsampled: false },
    liquidations: { bars: [], downsampled: false, undercounted: false } as never,
    liquidationEvents: [], liquidationVenues: [],
    dailyCandles: [],
    calendarEvents: [],
    ...over,
  };
}

const summary = (over: Partial<WebUniverseSummaryRow> = {}): WebUniverseSummaryRow => ({
  id: 'BTCUSDT', base: 'BTC', volumeRank: 1, lastPrice: 1, changePct24h: 1,
  fundingRate: 0.000123, nextFundingTimeMs: Date.UTC(2026, 9, 24, 16, 0), oiChangePct24h: -3.44, ...over,
});

describe('nowTiles', () => {
  it('takes the LATEST point of each series, not the last element', () => {
    const t = nowTiles(pane(), summary(), 'BTCUSDT');
    expect(t.oi).toBe('95,027');
    expect(t.oiUnit).toBe('BTC'); // the base asset, so it cannot be read as the pane's USD
    expect(t.ls).toBe('2.04');
  });

  it('prefers the live summary for funding and its settlement time', () => {
    const t = nowTiles(pane(), summary(), 'BTCUSDT');
    expect(t.funding).toBe('+0.0123');
    expect(t.nextFunding).toBe(timeOfDay(Date.UTC(2026, 9, 24, 16, 0) / 1000)); // the viewer's zone (IB-152)
    expect(t.oiChange).toBe('−3.4');
    expect(t.oiChangeSign).toBe(-1);
  });

  it('without the summary, funding falls back to the window and the 24 h change is absent', () => {
    const t = nowTiles(pane(), null, 'BTCUSDT');
    expect(t.funding).toBe('+0.0200'); // the latest predicted point (time 300), as a percentage
    expect(t.nextFunding).toBeNull();
    expect(t.oiChange).toBeNull(); // never derived from a window that may be under 24 h
  });

  it('CVD is the running taker delta, in the base asset', () => {
    // (2·8 − 10) + (2·9 − 10) = 6 + 8 = 14 BTC
    const t = nowTiles(pane(), null, 'BTCUSDT');
    expect(t.cvd).toBe('+14.0');
    expect(t.cvdUnit).toBe('BTC');
    expect(t.cvdSign).toBe(1);
  });

  it('no data gives nulls, never zeros', () => {
    const t = nowTiles(null, null, 'BTCUSDT');
    expect([t.oi, t.funding, t.cvd, t.ls, t.oiChange, t.nextFunding]).toEqual([null, null, null, null, null, null]);
  });

  it('a window whose candles carry no taker split has no CVD rather than a zero one', () => {
    const t = nowTiles(pane({ candles: { candles: [candle(60, 10, null)] } as never }), null, 'BTCUSDT');
    expect(t.cvd).toBeNull();
  });
});

describe('settleTime (IB-152)', () => {
  it('prints the viewer\'s clock: the same settlement reads differently in two zones', () => {
    expect(settleTime(Date.UTC(2026, 0, 1, 7, 5), 'UTC')).toBe('07:05');
    expect(settleTime(Date.UTC(2026, 0, 1, 7, 5), 'Europe/Kyiv')).toBe('09:05');
    expect(settleTime(null)).toBeNull();
  });
});

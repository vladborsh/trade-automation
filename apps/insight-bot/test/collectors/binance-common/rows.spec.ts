import type { Candle } from '@trade-automation/contracts';
import { candleRow, expectedBars, gapRow, symbolOf } from '../../../src/collectors/binance-common/rows';

/** IB-005 — Candle → candles_1m row, and a GapRepair hole → collector_gaps row. */

const CANDLE: Candle = {
  instrument: 'binance:BTCUSDT', timeframe: '1m', openTime: 1_727_481_600_000,
  open: 65012.3, high: 65080, low: 64990.1, close: 65044.7, volume: 318.421,
  closed: true, source: 'venue-stream',
  quoteVolume: 20707581.55, trades: 4127, takerBuyVolume: 171.884, takerBuyQuoteVolume: 11180012.09,
};

describe('candleRow (IB-005)', () => {
  it('carries IB-002s taker fields and keys the row by (venue, market, symbol, open_time)', () => {
    expect(candleRow(CANDLE, 'perp', 'ws')).toEqual({
      venue: 'binance', market: 'perp', symbol: 'BTCUSDT', openTime: new Date(1_727_481_600_000),
      open: 65012.3, high: 65080, low: 64990.1, close: 65044.7, volume: 318.421,
      quoteVolume: 20707581.55, trades: 4127, takerBuyVolume: 171.884, takerBuyQuoteVolume: 11180012.09,
      source: 'ws',
    });
  });

  it('a candle without the activity fields writes nulls, not zeros', () => {
    const bare: Candle = { ...CANDLE, quoteVolume: undefined, trades: undefined, takerBuyVolume: undefined, takerBuyQuoteVolume: undefined };
    expect(candleRow(bare, 'perp', 'rest')).toMatchObject({
      quoteVolume: null, trades: null, takerBuyVolume: null, takerBuyQuoteVolume: null, source: 'rest',
    });
  });

  it('a zero taker volume stays 0 — reported-as-zero is not absent', () => {
    expect(candleRow({ ...CANDLE, takerBuyVolume: 0 }, 'perp', 'ws').takerBuyVolume).toBe(0);
  });

  it('symbolOf strips the venue prefix and leaves a bare symbol alone', () => {
    expect(symbolOf('binance:ETHUSDT')).toBe('ETHUSDT');
    expect(symbolOf('SOLUSDT')).toBe('SOLUSDT');
  });
});

describe('gapRow and expectedBars (§3.3, §6.2)', () => {
  it('maps a repaired hole', () => {
    const detectedAt = new Date(1_727_481_720_000);
    expect(gapRow({
      stream: 'binance:perp:kline_1m', market: 'perp', symbol: 'BTCUSDT',
      from: 1_727_481_600_000, to: 1_727_481_660_000, expected: 2, repaired: 2, detectedAt,
    })).toEqual({
      stream: 'binance:perp:kline_1m', venue: 'binance', market: 'perp', symbol: 'BTCUSDT',
      gapFrom: new Date(1_727_481_600_000), gapTo: new Date(1_727_481_660_000),
      expected: 2, repaired: 2, error: null, detectedAt,
    });
  });

  it('an unrepairable hole keeps its error and repaired 0 — degraded forceOrder is written this way', () => {
    const row = gapRow({
      stream: 'binance:perp:forceOrder', market: 'perp', symbol: null,
      from: 1, to: 2, expected: 0, repaired: 0, error: 'degraded mode: no REST equivalent', detectedAt: new Date(3),
    });
    expect([row.symbol, row.repaired, row.error]).toEqual([null, 0, 'degraded mode: no REST equivalent']);
  });

  it('expectedBars counts both ends', () => {
    expect(expectedBars(1_727_481_600_000, 1_727_481_600_000)).toBe(1);
    expect(expectedBars(1_727_481_600_000, 1_727_481_720_000)).toBe(3);
    expect(expectedBars(1_727_481_720_000, 1_727_481_600_000)).toBe(0);
  });
});

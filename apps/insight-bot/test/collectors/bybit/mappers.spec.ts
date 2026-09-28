import { liquidationRowFromEvent } from '../../../src/collectors/binance-perp/mappers';
import { fundingSettlementRow, liquidationRows, markRowFromTicker } from '../../../src/collectors/bybit/mappers';
import type { BybitLiquidationEvent, BybitTickerData } from '../../../src/collectors/bybit/payloads';
import { LIQUIDATIONS, TICKER_SNAPSHOT } from './fixtures';

/** IB-008 — Bybit payloads (recorded from the live venue) → §3.3 rows. */

describe('Bybit mark/funding mapping (§4.3)', () => {
  it('maps a recorded tickers snapshot, stamped by the caller', () => {
    const ts = new Date(1_790_608_140_000);
    const row = markRowFromTicker('BTCUSDT', TICKER_SNAPSHOT.data as BybitTickerData, ts);
    expect(row).toEqual({
      venue: 'bybit', symbol: 'BTCUSDT', ts,
      markPrice: 82997.4, indexPrice: 83033, predictedFundingRate: 0.00005416,
      nextFundingTime: new Date(1_790_611_200_000), source: 'ws',
    });
  });

  it('missing fields are null, never 0, and an empty nextFundingTime is null', () => {
    const row = markRowFromTicker('XRPUSDT', { symbol: 'XRPUSDT', markPrice: '2.13', nextFundingTime: '' }, new Date(0));
    expect([row.indexPrice, row.predictedFundingRate, row.nextFundingTime]).toEqual([null, null, null]);
    expect(row.markPrice).toBe(2.13);
  });

  it('a negative predicted funding rate survives', () => {
    expect(markRowFromTicker('BTCUSDT', { symbol: 'BTCUSDT', fundingRate: '-0.00012500' }, new Date(0)).predictedFundingRate).toBe(-0.000125);
  });
});

describe('Bybit liquidation mapping — the side LIQUIDATED (§3.3, D6)', () => {
  it('maps the recorded allLiquidation pushes', () => {
    const rows = liquidationRows(LIQUIDATIONS[0].data as readonly BybitLiquidationEvent[]);
    expect(rows).toEqual([
      { venue: 'bybit', symbol: 'ETHUSDT', ts: new Date(1_790_608_175_868), side: 'short', price: 2679.27, qty: 0.08, notional: 2679.27 * 0.08, orderStatus: null, source: 'ws' },
    ]);
  });

  it('an array push becomes one row per event', () => {
    const events: BybitLiquidationEvent[] = [
      { T: 1, s: 'BTCUSDT', S: 'Buy', v: '0.5', p: '80000' },
      { T: 2, s: 'BTCUSDT', S: 'Sell', v: '0.25', p: '80100' },
    ];
    expect(liquidationRows(events).map((r) => [r.side, r.notional])).toEqual([['long', 40000], ['short', 20025]]);
  });

  it('BYBIT AND BINANCE ARE INVERTED, and both normalise to the side liquidated', () => {
    // Bybit doc: "When you receive a Buy update, this means that a long position has been liquidated"
    const bybitBuy = liquidationRows([{ T: 1, s: 'BTCUSDT', S: 'Buy', v: '1', p: '100' }])[0];
    // Binance: `S` is the side of the order the engine submits, so SELL closes (liquidates) a long
    const binanceSell = liquidationRowFromEvent({
      e: 'forceOrder', E: 1,
      o: { s: 'BTCUSDT', S: 'SELL', o: 'LIMIT', f: 'IOC', q: '1', p: '100', ap: '100', X: 'FILLED', l: '1', z: '1', T: 1 },
    });
    expect([bybitBuy.side, binanceSell.side]).toEqual(['long', 'long']); // same fact, opposite venue fields
    const bybitSell = liquidationRows([{ T: 1, s: 'BTCUSDT', S: 'Sell', v: '1', p: '100' }])[0];
    expect(bybitSell.side).toBe('short');
  });

  it('refuses a price or size that is not a number rather than writing NaN', () => {
    expect(() => liquidationRows([{ T: 1, s: 'BTCUSDT', S: 'Buy', v: 'x', p: '100' }])).toThrow(RangeError);
    expect(() => liquidationRows([{ T: 1, s: 'BTCUSDT', S: 'Buy', v: '1', p: '' }])).toThrow(RangeError);
  });
});

describe('Bybit funding history mapping', () => {
  it('maps a /v5/market/funding/history row (timestamps arrive as strings)', () => {
    expect(fundingSettlementRow({ symbol: 'BTCUSDT', fundingRate: '0.00005416', fundingRateTimestamp: '1790611200000' })).toEqual({
      venue: 'bybit', symbol: 'BTCUSDT', fundingTime: new Date(1_790_611_200_000), rate: 0.00005416, markPrice: null, source: 'rest',
    });
  });
});

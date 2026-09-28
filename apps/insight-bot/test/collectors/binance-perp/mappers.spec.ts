import { fundingSettlementRow, liquidationRowFromEvent, markRowFromEvent, markRowFromPremiumIndex } from '../../../src/collectors/binance-perp/mappers';
import type { ForceOrderEvent, MarkPriceEvent, PremiumIndexRow } from '../../../src/collectors/binance-perp/payloads';

/**
 * IB-005 — recorded Binance USD-M payload shapes → §3.3 rows. Fixtures keep the venue's field
 * names and string numbers exactly as the streams send them.
 */

const MARK: MarkPriceEvent = {
  e: 'markPriceUpdate', E: 1727481659000, s: 'BTCUSDT',
  p: '65044.70000000', i: '65040.12345678', P: '65050.00000000', r: '0.00012345', T: 1727510400000,
};

const FORCE_SELL: ForceOrderEvent = {
  e: 'forceOrder', E: 1727481660123,
  o: { s: 'ETHUSDT', S: 'SELL', o: 'LIMIT', f: 'IOC', q: '3.150', p: '2510.10', ap: '2509.84', X: 'FILLED', l: '3.150', z: '3.150', T: 1727481660100 },
};

describe('IB-005 mark price mapping (design §4.1, D5)', () => {
  it('stamps the row with the time the CALLER chose, never the event time', () => {
    const boundary = new Date(1727481660000); // the minute boundary, one second after E
    const row = markRowFromEvent(MARK, boundary);
    expect(row).toEqual({
      venue: 'binance', symbol: 'BTCUSDT', ts: boundary,
      markPrice: 65044.7, indexPrice: 65040.12345678, predictedFundingRate: 0.00012345,
      nextFundingTime: new Date(1727510400000), source: 'ws',
    });
    expect(row.ts.getTime()).not.toBe(MARK.E);
  });

  it('an absent index price is null, not 0', () => {
    const { i: _i, ...withoutIndex } = MARK;
    const row = markRowFromEvent(withoutIndex as MarkPriceEvent, new Date(0));
    expect(row.indexPrice).toBeNull();
    expect(row.markPrice).toBe(65044.7);
  });

  it('a zero nextFundingTime (no scheduled settlement) is null', () => {
    expect(markRowFromEvent({ ...MARK, T: 0 }, new Date(0)).nextFundingTime).toBeNull();
  });

  it('degraded mode: premiumIndex maps to the same shape with source rest', () => {
    const rest: PremiumIndexRow = {
      symbol: 'SOLUSDT', markPrice: '152.55000000', indexPrice: '152.50123456',
      estimatedSettlePrice: '152.60000000', lastFundingRate: '-0.00007500', interestRate: '0.00010000',
      nextFundingTime: 1727510400000, time: 1727481659000,
    };
    const ts = new Date(1727481660000);
    expect(markRowFromPremiumIndex(rest, ts)).toEqual({
      venue: 'binance', symbol: 'SOLUSDT', ts,
      markPrice: 152.55, indexPrice: 152.50123456, predictedFundingRate: -0.000075,
      nextFundingTime: new Date(1727510400000), source: 'rest',
    });
  });
});

describe('IB-005 liquidation mapping (§3.3, D6: the side LIQUIDATED)', () => {
  it('SELL liquidates a long; price and qty come from the filled fields; notional is their product', () => {
    expect(liquidationRowFromEvent(FORCE_SELL)).toEqual({
      venue: 'binance', symbol: 'ETHUSDT', ts: new Date(1727481660100), side: 'long',
      price: 2509.84, qty: 3.15, notional: 2509.84 * 3.15, orderStatus: 'FILLED', source: 'ws',
    });
  });

  it('BUY liquidates a short', () => {
    const buy: ForceOrderEvent = { ...FORCE_SELL, o: { ...FORCE_SELL.o, S: 'BUY' } };
    expect(liquidationRowFromEvent(buy).side).toBe('short');
  });

  it('falls back to the order price and quantity when the fill fields are still zero', () => {
    const unfilled: ForceOrderEvent = { ...FORCE_SELL, o: { ...FORCE_SELL.o, ap: '0', z: '0', X: 'NEW' } };
    const row = liquidationRowFromEvent(unfilled);
    expect([row.price, row.qty, row.orderStatus]).toEqual([2510.1, 3.15, 'NEW']);
  });

  it('the timestamp is the venue trade time, not the event time', () => {
    expect(liquidationRowFromEvent(FORCE_SELL).ts.getTime()).toBe(FORCE_SELL.o.T);
    expect(liquidationRowFromEvent(FORCE_SELL).ts.getTime()).not.toBe(FORCE_SELL.E);
  });
});

describe('IB-005 funding settlement mapping (§4.1)', () => {
  it('maps a /fapi/v1/fundingRate row', () => {
    expect(fundingSettlementRow({ symbol: 'BTCUSDT', fundingTime: 1727510400000, fundingRate: '0.00010000', markPrice: '65100.00' })).toEqual({
      venue: 'binance', symbol: 'BTCUSDT', fundingTime: new Date(1727510400000), rate: 0.0001, markPrice: 65100, source: 'rest',
    });
  });

  it('an empty markPrice is null; a negative rate survives', () => {
    const row = fundingSettlementRow({ symbol: 'ETHUSDT', fundingTime: 1727510400000, fundingRate: '-0.00023000', markPrice: '' });
    expect([row.markPrice, row.rate]).toEqual([null, -0.00023]);
  });

  it('refuses a rate that is not a number rather than writing NaN', () => {
    expect(() => fundingSettlementRow({ symbol: 'BTCUSDT', fundingTime: 1, fundingRate: 'n/a' })).toThrow(RangeError);
    // Number('') is 0: an empty field must be refused, not stored as a zero rate
    expect(() => fundingSettlementRow({ symbol: 'BTCUSDT', fundingTime: 1, fundingRate: '' })).toThrow(RangeError);
  });
});

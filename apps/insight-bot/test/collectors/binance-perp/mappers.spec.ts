import { fundingSettlementRow, isUsdtLinearPerp, liquidationRowFromEvent, markRowFromEvent, markRowFromPremiumIndex } from '../../../src/collectors/binance-perp/mappers';
import * as fs from 'fs';
import * as path from 'path';
import { demultiplex } from '../../../src/collectors/binance-common/socket';
import { isForceOrderEvent, type ForceOrderEvent, type MarkPriceEvent } from '../../../src/collectors/binance-perp/payloads';
import type { PremiumIndexRow } from '../../../src/venues/binance/payloads';

/**
 * IB-005 — recorded Binance USD-M payload shapes → §3.3 rows. Fixtures keep the venue's field
 * names and string numbers exactly as the streams send them.
 */

const MARK: MarkPriceEvent = {
  e: 'markPriceUpdate', E: 1727481659000, s: 'BTCUSDT',
  p: '65044.70000000', i: '65040.12345678', P: '65050.00000000', r: '0.00012345', T: 1727510400000,
};

// IB-BUG-012: the limit `p` is the bankruptcy price, BELOW the fill for an engine SELL. This
// hand-written event had it above (an impossible fill) until the mapper started asserting it.
const FORCE_SELL: ForceOrderEvent = {
  e: 'forceOrder', E: 1727481660123,
  o: { s: 'ETHUSDT', S: 'SELL', o: 'LIMIT', f: 'IOC', q: '3.150', p: '2496.50', ap: '2509.84', X: 'FILLED', l: '3.150', z: '3.150', T: 1727481660100 },
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
    const buy: ForceOrderEvent = { ...FORCE_SELL, o: { ...FORCE_SELL.o, S: 'BUY', p: '2523.10' } };
    expect(liquidationRowFromEvent(buy).side).toBe('short');
  });

  it('falls back to the order price and quantity when the fill fields are still zero', () => {
    const unfilled: ForceOrderEvent = { ...FORCE_SELL, o: { ...FORCE_SELL.o, ap: '0', z: '0', X: 'NEW' } };
    const row = liquidationRowFromEvent(unfilled);
    expect([row.price, row.qty, row.orderStatus]).toEqual([2496.5, 3.15, 'NEW']);
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

/**
 * IB-BUG-012 — six `!forceOrder@arr` envelopes captured live from `fstream.binance.com/market` on
 * 2026-10-29, byte for byte. They pin the payload SHAPE (field names, string numbers, the combined
 * envelope); a venue change fails here, at build time.
 */
describe('IB-BUG-012 live forceOrder fixture (shape and side invariant)', () => {
  const envelopes = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'fixtures', 'binance', 'forceOrder-arr.json'), 'utf8'),
  ) as unknown[];
  const events = envelopes.map((raw) => {
    const message = demultiplex(raw);
    expect(message?.stream).toBe('!forceOrder@arr');
    expect(isForceOrderEvent(message?.data)).toBe(true);
    return message?.data as ForceOrderEvent;
  });

  it('carries the fields the mapper reads, as strings where the venue sends strings', () => {
    for (const event of events) {
      expect(Object.keys(event.o).sort()).toEqual(['S', 'T', 'X', 'ap', 'f', 'l', 'o', 'p', 'ps', 'q', 's', 'st', 'z']);
      for (const field of ['q', 'p', 'ap', 'l', 'z'] as const) expect(typeof event.o[field]).toBe('string');
      expect(typeof event.o.T).toBe('number');
    }
  });

  it('maps every captured event: SELL → long, BUY → short, priced at the average fill', () => {
    const rows = events.map(liquidationRowFromEvent);
    expect(rows.map((r) => `${r.symbol}:${r.side}`)).toEqual([
      'KGENUSDT:long', 'KGENUSDT:long', 'XAUTUSDT:long', 'TRXUSDT:short', 'TRXUSDT:short', 'ZAMAUSDT:short',
    ]);
    expect(rows[2]).toMatchObject({ price: 4005, qty: 0.015, ts: new Date(1793317730383), orderStatus: 'FILLED' });
  });

  it('the engine SELL fills at or above its limit, the BUY at or below — in every captured event', () => {
    for (const { o } of events) {
      if (o.S === 'SELL') expect(Number(o.ap)).toBeGreaterThanOrEqual(Number(o.p));
      else expect(Number(o.ap)).toBeLessThanOrEqual(Number(o.p));
    }
  });

  it('refuses an event whose side contradicts its fill rather than writing a mirror-image row', () => {
    for (const event of events) {
      const flipped: ForceOrderEvent = { ...event, o: { ...event.o, S: event.o.S === 'SELL' ? 'BUY' : 'SELL' } };
      expect(() => liquidationRowFromEvent(flipped)).toThrow(/cannot fill there/);
    }
  });

  it('refuses a side that is neither BUY nor SELL', () => {
    const odd = { ...events[0], o: { ...events[0].o, S: 'LONG' } } as unknown as ForceOrderEvent;
    expect(() => liquidationRowFromEvent(odd)).toThrow(/neither BUY nor SELL/);
  });

  it('an equal fill and limit is consistent for either side', () => {
    const at = { ...events[0], o: { ...events[0].o, ap: events[0].o.p } };
    expect(liquidationRowFromEvent(at).side).toBe('long');
    expect(liquidationRowFromEvent({ ...at, o: { ...at.o, S: 'BUY' } }).side).toBe('short');
  });
});

/**
 * IB-BUG-018 — which contracts' forceOrder can be priced as `price × qty` in USD: USDT-linear
 * perpetuals only. Every shape below was seen on insight_coord's `liquidations` 2026-11-02/03.
 */
describe('IB-BUG-018 isUsdtLinearPerp and the mapper backstop', () => {
  it('accepts <BASE>USDT, including numeric bases', () => {
    for (const ok of ['BTCUSDT', '1000PEPEUSDT', 'XAUTUSDT', 'KGENUSDT']) expect(isUsdtLinearPerp(ok)).toBe(true);
    // non-ASCII bases are real USDT-linear perps (seen live 2026-11-03); the first rule dropped them
    for (const ok of ['币安人生USDT', '我踏马来了USDT', '牛来USDT']) expect(isUsdtLinearPerp(ok)).toBe(true);
  });

  it('refuses COIN-M perps and quarterlies, USDT quarterlies, BTC-quoted, and stablecoin-margined shapes', () => {
    for (const bad of ['BTCUSD_PERP', 'BNBUSD_270326', 'BTCUSD_261225', 'BTCUSDT_261225', 'ETHBTC', 'ETHUSDC', 'BTCUSD1', 'BTCU', '']) {
      expect(isUsdtLinearPerp(bad)).toBe(false);
    }
  });

  it('the mapper itself throws on a COIN-M event, so a caller that forgets the filter cannot store it', () => {
    const coinm: ForceOrderEvent = {
      e: 'forceOrder', E: 1,
      o: { s: 'BTCUSD_PERP', S: 'SELL', o: 'LIMIT', f: 'IOC', q: '897', p: '76000', ap: '76427', X: 'FILLED', l: '897', z: '897', T: 1 },
    };
    // the coordinator's row: 897 contracts × $100 ≈ $89.7k, stored as 897 × 76 427 = $68.6M
    expect(() => liquidationRowFromEvent(coinm)).toThrow(/not a USDT-linear perpetual/);
  });
});

/**
 * IB-BUG-018 — a real COIN-M `forceOrder`, captured from `fstream.binance.com/market`
 * `!forceOrder@arr` on 2026-11-03 14:02:44 UTC (one event in 787 over 28 min: 775 USDT, 11 USDC,
 * 1 COIN-M). Same envelope and fields as a USDT-M event — nothing in the SHAPE says "inverse"
 * except the symbol, which is why the symbol rule is the guard.
 */
describe('IB-BUG-018 live COIN-M forceOrder fixture', () => {
  const [raw] = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'fixtures', 'binance', 'forceOrder-coinm.json'), 'utf8')) as unknown[];
  const message = demultiplex(raw);
  const event = message?.data as ForceOrderEvent;

  it('arrives on the same stream, in the same shape, as a USDT-M liquidation', () => {
    expect(message?.stream).toBe('!forceOrder@arr');
    expect(isForceOrderEvent(event)).toBe(true);
    expect(event.o.s).toBe('BTCUSD_PERP');
  });

  it('is refused by the rule, and the mapper throws rather than store 250 contracts × 77 090 as $19.3M', () => {
    expect(isUsdtLinearPerp(event.o.s)).toBe(false);
    expect(() => liquidationRowFromEvent(event)).toThrow(/not a USDT-linear perpetual/);
  });
});

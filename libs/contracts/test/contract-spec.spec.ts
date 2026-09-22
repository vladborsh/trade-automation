import { BacktestInstrumentSchema, ContractSpecSchema, ErrorResponseSchema, InstrumentSchema, OrderSchema } from '../src';

/** T-035 — D12's contract block on the wire and in configuration, and the two new refusal codes. */
describe('ContractSpec (D12)', () => {
  const btc = { unit: 'BTC', multiplier: 1, minQty: 0.001, qtyStep: 0.001, minNotional: 50, maxLeverage: 125 };
  const fx = { unit: 'EUR', multiplier: 1, minQty: 100, qtyStep: 100, maxLeverage: 30, displayLot: 100_000 };

  it('parses the Binance and FX shapes (minNotional and displayLot optional)', () => {
    expect(ContractSpecSchema.parse(btc)).toEqual(btc);
    expect(ContractSpecSchema.parse(fx)).toEqual(fx);
  });

  it('refuses a non-positive multiplier / step / minimum and a leverage below 1', () => {
    for (const bad of [{ multiplier: 0 }, { qtyStep: 0 }, { minQty: -1 }, { maxLeverage: 0.5 }, { minNotional: 0 }, { unit: '' }]) {
      expect(() => ContractSpecSchema.parse({ ...btc, ...bad })).toThrow();
    }
  });

  it('an Instrument carries its optional contract through the parse', () => {
    const base = { id: 'binance:BTCUSDT', venue: 'binance', symbol: 'BTCUSDT', assetClass: 'crypto-perp', displayName: 'BTC', pricePrecision: 2, quoteCurrency: 'USDT', sessionTimezone: 'UTC' };
    expect(InstrumentSchema.parse({ ...base, contract: btc }).contract).toEqual(btc);
    expect(InstrumentSchema.parse(base).contract).toBeUndefined();
  });

  it('a BacktestInstrument must say contract: a block or null', () => {
    const base = { id: 'binance:BTCUSDT', displayName: 'BTC', assetClass: 'crypto-perp', sessionCurrency: 'USD', pricePrecision: 2, coverage: null };
    expect(BacktestInstrumentSchema.parse({ ...base, contract: btc }).contract).toEqual(btc);
    expect(BacktestInstrumentSchema.parse({ ...base, contract: null }).contract).toBeNull();
    expect(() => BacktestInstrumentSchema.parse(base)).toThrow();
  });

  it('an Order carries a required, positive contractMultiplier (T-053: stored on the row)', () => {
    const order = {
      id: '00000000-0000-4000-8000-000000000001', sessionId: '00000000-0000-4000-8000-000000000002', seq: 1, panelId: 'p',
      instrument: 'binance:BTCUSDT', side: 'long', type: 'market', status: 'open', placedAtMs: 1, limitPrice: null, entryPrice: 100,
      entryTimeMs: 1, qty: 1, riskPct: 1, riskAmountCcy: 10, slInitial: 90, slCurrent: 90, tpInitial: null, tpCurrent: null,
      exitPrice: null, exitTimeMs: null, closeReason: null, fillResolution: null, slTpSameBar: false, commissionCcy: 0,
      spreadCostCcy: 0, pnlCcy: null, pnlR: null, maePrice: null, maeR: null, cancelledAtMs: null, createdAt: 1, updatedAt: 1,
    };
    expect(() => OrderSchema.parse(order)).toThrow(); // required since T-053
    expect(OrderSchema.parse({ ...order, contractMultiplier: 100 }).contractMultiplier).toBe(100);
    expect(() => OrderSchema.parse({ ...order, contractMultiplier: 0 })).toThrow();
  });

  it('accepts the two D12 refusal codes', () => {
    for (const code of ['SIZE_BELOW_MINIMUM', 'INSUFFICIENT_MARGIN'] as const) {
      expect(ErrorResponseSchema.parse({ error: { code, message: 'x' } }).error.code).toBe(code);
    }
  });
});

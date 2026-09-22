import type { BacktestInstrumentsResponse } from '@trade-automation/contracts';
import { DEFAULT_PRICE_PRECISION, InstrumentFacts } from './instrument-facts';

const BTC = { unit: 'BTC', multiplier: 1, minQty: 0.001, qtyStep: 0.001, minNotional: 50, maxLeverage: 125 };
const INSTRUMENTS = [
  { id: 'binance:BTCUSDT', pricePrecision: 2, contract: BTC },
  { id: 'capitalcom:EURUSD', pricePrecision: 5, contract: { unit: 'EUR', multiplier: 1, minQty: 1000, qtyStep: 1000, maxLeverage: 30, displayLot: 100_000 } },
  { id: 'capitalcom:XAUUSD', pricePrecision: 3, contract: null },
] as unknown as BacktestInstrumentsResponse;

describe('InstrumentFacts (T-054)', () => {
  it('keeps each instrument’s price precision and contract', () => {
    const facts = new InstrumentFacts();
    facts.set(INSTRUMENTS);
    expect(facts.precisionOf('binance:BTCUSDT')).toBe(2);
    expect(facts.precisionOf('capitalcom:EURUSD')).toBe(5);
    expect(facts.contractOf('binance:BTCUSDT')).toEqual(BTC);
    expect(facts.contractOf('capitalcom:XAUUSD')).toBeNull();
    expect([...facts.pricePrecision()]).toEqual([['binance:BTCUSDT', 2], ['capitalcom:EURUSD', 5], ['capitalcom:XAUUSD', 3]]);
    expect([...facts.units()]).toEqual([['binance:BTCUSDT', 'BTC'], ['capitalcom:EURUSD', 'EUR']]);
  });

  it('an unknown instrument: the default precision, no contract', () => {
    const facts = new InstrumentFacts();
    expect(facts.precisionOf('binance:ETHUSDT')).toBe(DEFAULT_PRICE_PRECISION);
    expect(facts.precisionOf(undefined)).toBe(DEFAULT_PRICE_PRECISION);
    expect(facts.contractOf('binance:ETHUSDT')).toBeNull();
  });
});

import type { BacktestInstrument, InstrumentId } from '@trade-automation/contracts';

/** Shared fixtures for the sessions specs (not a spec itself; same convention as calendar-test-events.ts). */
export const DAY = 86_400_000;
export const T0 = Date.UTC(2021, 0, 1);

export const CATALOGUE_LIST: BacktestInstrument[] = [
  { id: 'binance:BTCUSDT', displayName: 'BTC/USDT Perp', assetClass: 'crypto-perp', sessionCurrency: 'USD', pricePrecision: 2, coverage: { from: T0, to: T0 + 300 * DAY }, contract: null },
  { id: 'binance:ETHUSDT', displayName: 'ETH/USDT Perp', assetClass: 'crypto-perp', sessionCurrency: 'USD', pricePrecision: 2, coverage: { from: T0 + 100 * DAY, to: T0 + 400 * DAY }, contract: null },
  { id: 'capitalcom:EURCHF', displayName: 'EUR/CHF', assetClass: 'forex-cfd', sessionCurrency: 'CHF', pricePrecision: 5, coverage: { from: T0, to: T0 + 300 * DAY }, contract: null },
  { id: 'capitalcom:US100', displayName: 'US Tech 100', assetClass: 'index-cfd', sessionCurrency: 'USD', pricePrecision: 1, coverage: null, contract: null },
];

export const CATALOGUE = new Map<InstrumentId, BacktestInstrument>(CATALOGUE_LIST.map((i) => [i.id, i]));

import { BacktestInstrumentsResponseSchema, Instrument } from '@trade-automation/contracts';
import { BacktestInstrumentsController } from '../../src/api/rest/backtest/instruments.controller';
import { AppConfigService } from '../../src/config/config.service';
import { CandleStore } from '../../src/storage/candle-store.port';

const btc: Instrument = {
  id: 'binance:BTCUSDT',
  venue: 'binance',
  symbol: 'BTCUSDT',
  assetClass: 'crypto-perp',
  displayName: 'BTC',
  pricePrecision: 2,
  quoteCurrency: 'USDT',
  sessionCurrency: 'USD',
  sessionTimezone: 'UTC',
  contract: { unit: 'BTC', multiplier: 1, minQty: 0.001, qtyStep: 0.001, minNotional: 50, maxLeverage: 125 },
};

const eurchf: Instrument = {
  id: 'capitalcom:EURCHF',
  venue: 'capitalcom',
  symbol: 'EURCHF',
  assetClass: 'forex-cfd',
  displayName: 'EUR/CHF',
  pricePrecision: 5,
  quoteCurrency: 'CHF',
  sessionCurrency: 'CHF',
  sessionTimezone: 'UTC',
};

describe('GET /api/backtest/instruments (backtest-app-system-design.md §7.2)', () => {
  it('returns every configured instrument with its 1m coverage and contract block, null when absent', async () => {
    const config = { instruments: [btc, eurchf] } as unknown as AppConfigService;
    const coverage = jest.fn(async (id: string) =>
      id === 'binance:BTCUSDT' ? { from: 1_567_900_800_000, to: 1_790_000_000_000 } : null,
    );
    const store = { coverage } as unknown as CandleStore;

    const body = await new BacktestInstrumentsController(config, store).list();

    expect(body).toEqual([
      {
        id: 'binance:BTCUSDT',
        displayName: 'BTC',
        assetClass: 'crypto-perp',
        pricePrecision: 2,
        sessionCurrency: 'USD', // as configured — not coalesced to quoteCurrency 'USDT'
        coverage: { from: 1_567_900_800_000, to: 1_790_000_000_000 },
        contract: { unit: 'BTC', multiplier: 1, minQty: 0.001, qtyStep: 0.001, minNotional: 50, maxLeverage: 125 },
      },
      {
        id: 'capitalcom:EURCHF',
        displayName: 'EUR/CHF',
        assetClass: 'forex-cfd',
        pricePrecision: 5,
        sessionCurrency: 'CHF',
        coverage: null,
        contract: null, // no contract block configured
      },
    ]);
    expect(BacktestInstrumentsResponseSchema.parse(body)).toEqual(body);
    expect(coverage.mock.calls).toEqual([
      ['binance:BTCUSDT', '1m'],
      ['capitalcom:EURCHF', '1m'],
    ]);
  });
});

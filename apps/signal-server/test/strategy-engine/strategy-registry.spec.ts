import { StrategyConfigEntry } from '../../src/config/strategies.schema';
import { CandleCache } from '../../src/market-data/candle-cache.service';
import { IndicatorCache } from '../../src/strategy-engine/indicator-cache.service';
import { StrategyRegistryService } from '../../src/strategy-engine/strategy-registry.service';

function fakeConfig(strategies: StrategyConfigEntry[]) {
  return { strategies, instruments: [] } as never;
}

describe('StrategyRegistryService venue guard (architecture/vwap-band-reversal-plugin.md §5.2)', () => {
  it('boots fine when vwap-band-reversal is only configured for capitalcom instruments', () => {
    const config = fakeConfig([
      {
        id: 'vwap-band-reversal',
        enabled: true,
        instruments: ['capitalcom:US100', 'capitalcom:EURCHF'],
        params: {
          sessionTimezone: 'America/New_York',
          minVwapAtrRatio: 2.5,
          maxVwapAtrRatio: 11.5,
          maxIfvgToAtrRatio: 8,
          targetRr: 3,
          rangeBars: 200,
          atrBars: 20,
          mainWindowMinutes: 720,
          entryWindow: {
            'capitalcom:US100': ['09:40', '11:40'],
            'capitalcom:EURCHF': ['03:02', '03:20'],
          },
        },
      },
    ]);

    expect(() => new StrategyRegistryService(config, new CandleCache(), new IndicatorCache())).not.toThrow();
  });

  it('refuses to boot with vwap-band-reversal configured for a non-capitalcom (binance) instrument', () => {
    const config = fakeConfig([
      {
        id: 'vwap-band-reversal',
        enabled: true,
        instruments: ['binance:BTCUSDT'],
        params: {
          sessionTimezone: 'America/New_York',
          minVwapAtrRatio: 2.5,
          maxVwapAtrRatio: 11.5,
          maxIfvgToAtrRatio: 8,
          targetRr: 3,
          rangeBars: 200,
          atrBars: 20,
          mainWindowMinutes: 720,
          entryWindow: { 'binance:BTCUSDT': ['09:40', '11:40'] },
        },
      },
    ]);

    expect(() => new StrategyRegistryService(config, new CandleCache(), new IndicatorCache())).toThrow(
      /restricted to venue/,
    );
  });
});

import { GeneralTimeIntervals } from '../types/enums';
import { Duration } from 'date-fns';
import { BinanceClient } from '../core/services/binance-client';
import { CapitalComSession } from '../core/services/capital-com-session';
import { CapitalComClient } from '../core/services/capital-com-client';
import { EnvConfig } from '../env-config';
import { DynamicConfig } from '../utils/dynamic-config';
import { IExchangeClient } from '../interfaces/exchange-client.interface';
import { StrategyTemplate } from '../strategy/strategy-template';
import { SmartMoneyStrategy } from '../strategy/smartmoney-strategy';
import { VWapStrategy } from '../strategy/vwap-strategy';
import { RiskManager } from '../strategy/risk-manager';

export function convertIntervalToDuration(interval: GeneralTimeIntervals): Duration {
  const config: Record<GeneralTimeIntervals, Duration> = {
    [GeneralTimeIntervals.m1]: { minutes: 1 },
    [GeneralTimeIntervals.m3]: { minutes: 3 },
    [GeneralTimeIntervals.m5]: { minutes: 5 },
    [GeneralTimeIntervals.m15]: { minutes: 15 },
    [GeneralTimeIntervals.m30]: { minutes: 30 },
    [GeneralTimeIntervals.h1]: { hours: 1 },
    [GeneralTimeIntervals.h4]: { hours: 4 },
    [GeneralTimeIntervals.d1]: { days: 1 },
    [GeneralTimeIntervals.w1]: { weeks: 1 },
  };
  return config[interval];
}

export async function getExchangeClient(
  envConfig: EnvConfig,
  dynamicConfig: DynamicConfig,
  symbol: string
): Promise<IExchangeClient> {
  if (symbol.endsWith('USDT')) {
    return BinanceClient.getInstance(envConfig, dynamicConfig);
  } else {
    const capitalComSession = CapitalComSession.getInstance(envConfig);
    await capitalComSession.checkAndRenewSession();
    return CapitalComClient.getInstance(envConfig, capitalComSession);
  }
}

export function getStrategyFactoryByKey(
  key: string,
  client: IExchangeClient,
  symbol: string,
  hyperParameters: Record<string, any>,
): () => StrategyTemplate {
  const config: Record<string, () => StrategyTemplate> = {
    sm: () => new SmartMoneyStrategy(client, symbol, symbol.toLowerCase(), new RiskManager()),
    vwap: () =>
      new VWapStrategy(
        client,
        symbol,
        symbol.toLowerCase(),
        hyperParameters,
        new RiskManager()
      ),
  };

  if (!config[key]) {
    throw new Error(`Strategy with key ${key} not found`);
  }

  return config[key];
}

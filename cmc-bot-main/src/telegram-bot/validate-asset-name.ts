import { DynamicConfig } from '../utils/dynamic-config';
import { GeneralTimeIntervals } from '../types/enums';
import { EnvConfig } from '../env-config';
import { BinanceClient } from '../core/services/binance-client';
import { ParsedAssetInfo } from '../interfaces/parsed-asset-info.interface';
import { Exchange } from '../interfaces/user-state.interface';
import { container } from '../container';

export async function validateAssetName(
  text: string | undefined,
  envConfig: EnvConfig,
): Promise<ParsedAssetInfo> {
  if (!text) {
    throw new Error(`invalid command: there is no text`);
  }
  let [asset, timeFrame, exchange] = text.split(' ');

  asset = asset.toUpperCase();
  const dynamicConfig = container.get(DynamicConfig);
  const dynamicConfigValues = await dynamicConfig.getConfig();

  if (dynamicConfigValues.ASSET_SHORTCUTS[asset]) {
    const [assetName, exchangeName] = dynamicConfigValues.ASSET_SHORTCUTS[asset];
    asset = assetName;
    exchange = exchangeName;
  }

  if (!exchange) {
    exchange = 'binance';
  }

  if (!!exchange && exchange !== 'binance' && exchange !== 'capitalcom') {
    if (dynamicConfigValues.EXCHANGE_SHORTCUTS[exchange.toUpperCase()]) {
      const exchangeName = dynamicConfigValues.EXCHANGE_SHORTCUTS[exchange.toUpperCase()];
      exchange = exchangeName;
    } else {
      throw new Error(`Unsupported exchange "${exchange}"`);
    }
  }

  if (exchange === 'binance') {
    if (!asset.includes('USDT')) {
      asset = `${asset}USDT`;
    }
    const binanceClient = container.get(BinanceClient);
    if (!(await binanceClient.isSymbolExists(asset))) {
      throw new Error(`Binance does not support: "${asset}"`);
    }
  }
  if (!timeFrame || !ALLOWED_TIME_FRAMES.includes(timeFrame as GeneralTimeIntervals)) {
    throw new Error(`invalid time frame: "${timeFrame}"`);
  }

  return {
    asset,
    timeFrame: timeFrame as GeneralTimeIntervals,
    exchange: exchange as Exchange,
  };
}

const ALLOWED_TIME_FRAMES: GeneralTimeIntervals[] = [
  GeneralTimeIntervals.m1,
  GeneralTimeIntervals.m5,
  GeneralTimeIntervals.m15,
  GeneralTimeIntervals.h1,
  GeneralTimeIntervals.h4,
];

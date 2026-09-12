import { CandleChartInterval_LT } from 'binance-api-node';
import { CapComTimeIntervals } from '../../types/enums';

const intervalMappingBinance: Record<CandleChartInterval_LT, number> = {
  '1m': 1 * 60 * 1000,
  '3m': 3 * 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 1 * 60 * 60 * 1000,
  '2h': 2 * 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '8h': 8 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '1d': 1 * 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '1w': 1 * 7 * 24 * 60 * 60 * 1000,
  '1M': 1 * 30 * 24 * 60 * 60 * 1000,
};

const intervalMappingCapCom: Record<CapComTimeIntervals, number> = {
  [CapComTimeIntervals.MINUTE]: 1 * 60 * 1000,
  [CapComTimeIntervals.MINUTE_3]: 3 * 60 * 1000,
  [CapComTimeIntervals.MINUTE_5]: 5 * 60 * 1000,
  [CapComTimeIntervals.MINUTE_15]: 15 * 60 * 1000,
  [CapComTimeIntervals.MINUTE_30]: 30 * 60 * 1000,
  [CapComTimeIntervals.HOUR]: 1 * 60 * 60 * 1000,
  [CapComTimeIntervals.HOUR_4]: 4 * 60 * 60 * 1000,
  [CapComTimeIntervals.DAY]: 1 * 24 * 60 * 60 * 1000,
  [CapComTimeIntervals.WEEK]: 1 * 7 * 24 * 60 * 60 * 1000,
};

export function timeIntervalBinanceToMillis(interval: CandleChartInterval_LT): number {
  return intervalMappingBinance[interval];
}

export function timeIntervalCapComToMillis(interval: CapComTimeIntervals): number {
  return intervalMappingCapCom[interval];
}

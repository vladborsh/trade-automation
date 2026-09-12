import { CandleChartInterval_LT } from "binance-api-node";
import { GeneralTimeIntervals } from "../../../types/enums";

export const mapGeneralTimeIntervalToBinance: Record<GeneralTimeIntervals, CandleChartInterval_LT> = {
  [GeneralTimeIntervals.m1]: '1m',
  [GeneralTimeIntervals.m3]: '3m',
  [GeneralTimeIntervals.m5]: '5m',
  [GeneralTimeIntervals.m15]: '15m',
  [GeneralTimeIntervals.m30]: '30m',
  [GeneralTimeIntervals.h1]: '1h',
  [GeneralTimeIntervals.h4]: '4h',
  [GeneralTimeIntervals.d1]: '1d',
  [GeneralTimeIntervals.w1]: '1w',
};

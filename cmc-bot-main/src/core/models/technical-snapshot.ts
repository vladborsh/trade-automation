import { GeneralTimeIntervals } from "../../types/enums";
import { IndicatorResult } from "./indicator-result";

export interface TechnicalSnapshot {
  symbol: string;
  timeframe: GeneralTimeIntervals;
  indicators: Record<string, IndicatorResult>
  timestamp?: number;
}

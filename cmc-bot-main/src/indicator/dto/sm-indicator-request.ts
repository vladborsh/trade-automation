import { CandleChartData } from "../../interfaces/charts/candlestick-chart-data";

export interface SmIndicatorRequest {
  inputs?: SmIndicatorInputs;
  chartData: CandleChartData[];
}

export interface SmIndicatorInputs {
  structureLength?: number;
  internalStructureLength?: number;
  highStructureLength?: number;
  sessions?: SmIndicatorSessions[];
  timings?: {
    time: string;
    label: string;
  }[],// [8:00]
  isEODShown?: boolean;
  EQLength?: number;
  EQThreshold?: number;
  EQThresholdAtr?: number;
  includeFVGHightTimeFrame?: boolean;
}

interface SmIndicatorSessions {
  name?: string;
  hourStart: number;
  hourEnd: number;
}

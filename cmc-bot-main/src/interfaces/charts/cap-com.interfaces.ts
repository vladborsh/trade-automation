import { CapComTimeIntervals } from "../../types/enums";
import { WSCapComMarketData } from "../capital-com.interfaces";
import { CandleChartData } from "./candlestick-chart-data";

export interface EpicObject {
  epic: string;
  interval: CapComTimeIntervals;
}

export interface BidAsk {
  bid?: WSCapComMarketData;
  ask?: WSCapComMarketData;
}

export interface EpicDataWSEvent {
  epic: string;
  data: CandleChartData;
}

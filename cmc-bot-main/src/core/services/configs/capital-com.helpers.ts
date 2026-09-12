import { CapComTimeIntervals } from "../../../types/enums";
import { chop } from "../../../utils/formatting";
import { CapComMarketData, WSCapComMarketData } from "../../../interfaces/capital-com.interfaces";
import { CandleChartData } from "../../../interfaces/charts/candlestick-chart-data";
import { timeIntervalCapComToMillis } from "../exchange-helpers";

export function mapMarketDataToChartData(rawData: CapComMarketData): CandleChartData[] {
  return rawData.prices.map<CandleChartData>((candle) => ({
    openTime: Date.parse(candle.snapshotTime),
    open: (candle.openPrice.ask + candle.openPrice.bid) / 2,
    high: (candle.highPrice.ask + candle.highPrice.bid) / 2,
    low: (candle.lowPrice.ask + candle.lowPrice.bid) / 2,
    close: (candle.closePrice.ask + candle.closePrice.bid) / 2,
    volume: candle.lastTradedVolume,
  }));
}

export function  mapWSMarketDataToChartData(
  bid: WSCapComMarketData,
  ask: WSCapComMarketData
): CandleChartData {
  return {
    openTime: bid.payload.t,
    open: (bid.payload.o + ask.payload.o) / 2,
    high: (bid.payload.h + ask.payload.h) / 2,
    low: (bid.payload.l + ask.payload.l) / 2,
    close: (bid.payload.c + ask.payload.c) / 2,
    volume: 0,
  };
}

export function  getFromToDate(interval: CapComTimeIntervals, limit: number): [string, string] {
  const timeBackShift = limit * timeIntervalCapComToMillis(interval);
  const fromDate = chop(new Date(Date.now() - timeBackShift).toISOString());
  const toDate = chop(new Date().toISOString());

  return [fromDate, toDate];
}

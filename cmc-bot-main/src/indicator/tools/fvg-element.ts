import { CandleChartData } from '../../interfaces/charts/candlestick-chart-data';
import { OrderDirection } from '../../strategy/enum/order-direction.enum';
import { Nullable } from '../../types/types';
import { FVG } from '../interfaces/fvg';
import { PlotRectangle } from '../interfaces/plot-rectangle';

interface FvgFilterResponse {
  newBullishFvg: FVG[];
  newBearishFvg: FVG[];
  newInverseBearishFvg: FVG[];
  newInverseBullishFvg: FVG[];
  isLastCandleDiscardBearishFvg: boolean;
  isLastCandleDiscardBullishFvg: boolean;
}

export function getFvgElement(
  i: number,
  currentBlock: CandleChartData,
  prevBlock: CandleChartData,
  htfIndex?: number
): { bullish: Nullable<FVG>; bearish: Nullable<FVG> } {
  let bullish: Nullable<FVG> = null;
  let bearish: Nullable<FVG> = null;

  if (currentBlock.close > prevBlock.open && currentBlock.low > prevBlock.high) {
    bullish = {
      low: prevBlock.high,
      high: currentBlock.low,
      x: i - (!!htfIndex ? htfIndex : 0),
    };
  }

  if (currentBlock.close < prevBlock.open && currentBlock.high < prevBlock.low) {
    bearish = {
      low: currentBlock.high,
      high: prevBlock.low,
      x: i - (!!htfIndex ? htfIndex : 0),
    };
  }

  return { bullish, bearish };
}

export function filterFvgArrays(
  open: number,
  close: number,
  bullishFvg: FVG[],
  bearishFvg: FVG[]
): FvgFilterResponse {
  const newBullishFvg: FVG[] = [];
  const newBearishFvg: FVG[] = [];
  const newInverseBearishFvg: FVG[] = [];
  const newInverseBullishFvg: FVG[] = [];
  let isLastCandleDiscardBearishFvg = false;
  let isLastCandleDiscardBullishFvg = false;

  for (let i = 0; i < bullishFvg.length; i++) {
    if (!(open > bullishFvg[i].low && close < bullishFvg[i].low)) {
      newBullishFvg.push(bullishFvg[i]);
    } else {
      isLastCandleDiscardBullishFvg = true;
      newInverseBearishFvg.push(bullishFvg[i]);
    }
  }
  for (let i = 0; i < bearishFvg.length; i++) {
    if (!(open < bearishFvg[i].high && close > bearishFvg[i].high)) {
      newBearishFvg.push(bearishFvg[i]);
    } else {
      isLastCandleDiscardBearishFvg = true;
      newInverseBullishFvg.push(bearishFvg[i]);
    }
  }

  return {
    newBullishFvg,
    newBearishFvg,
    newInverseBearishFvg,
    newInverseBullishFvg,
    isLastCandleDiscardBearishFvg,
    isLastCandleDiscardBullishFvg,
  };
}

export function filterInverseFvgArrays(
  open: number,
  close: number,
  bullishInverseFvg: FVG[],
  bearishInverseFvg: FVG[]
): { newInverseBearishFvg: FVG[]; newInverseBullishFvg: FVG[] } {
  const newInverseBearishFvg: FVG[] = [];
  const newInverseBullishFvg: FVG[] = [];

  for (let i = 0; i < bullishInverseFvg.length; i++) {
    if (!(open > bullishInverseFvg[i].low && close < bullishInverseFvg[i].low)) {
      newInverseBullishFvg.push(bullishInverseFvg[i]);
    }
  }

  for (let i = 0; i < bearishInverseFvg.length; i++) {
    if (!(open < bearishInverseFvg[i].high && close > bearishInverseFvg[i].high)) {
      newInverseBearishFvg.push(bearishInverseFvg[i]);
    }
  }

  return { newInverseBearishFvg, newInverseBullishFvg };
}

export function convertFvfToRenderable(fvg: FVG, chartDataLength: number, color: string): PlotRectangle {
  return {
    left: fvg.x,
    top: fvg.high,
    bottom: fvg.low,
    right: chartDataLength,
    color,
  }
}

export class FvgCalculator {
  bullishFvgArray: FVG[] = [];
  bullishIFvgArray: FVG[] = [];
  bearishFvgArray: FVG[] = [];
  bearishIFvgArray: FVG[] = [];

  isLastCandleDiscardBullishFvg: boolean = false;
  isLastCandleDiscardBearishFvg: boolean = false;

  public calculateStep(barIndex: number, chartData: CandleChartData[], open: number, close: number) {
    if (barIndex > 2) {
      const fvgElement = getFvgElement(barIndex, chartData[barIndex], chartData[barIndex - 2]);
      if (fvgElement.bullish !== null) this.bullishFvgArray.push(fvgElement.bullish);
      if (fvgElement.bearish !== null) this.bearishFvgArray.push(fvgElement.bearish);
      const processedFvgs = filterFvgArrays(open, close, this.bullishFvgArray, this.bearishFvgArray);
      this.bullishFvgArray = processedFvgs.newBullishFvg;
      this.bearishFvgArray = processedFvgs.newBearishFvg;

      this.bullishIFvgArray = [...this.bullishIFvgArray, ...processedFvgs.newInverseBullishFvg];
      this.bearishIFvgArray = [...this.bearishIFvgArray, ...processedFvgs.newInverseBearishFvg];

      const { newInverseBullishFvg, newInverseBearishFvg } = filterInverseFvgArrays(
        open,
        close,
        this.bullishIFvgArray,
        this.bearishIFvgArray
      );
      this.bullishIFvgArray = newInverseBullishFvg;
      this.bearishIFvgArray = newInverseBearishFvg;

      this.isLastCandleDiscardBullishFvg = processedFvgs.isLastCandleDiscardBullishFvg;
      this.isLastCandleDiscardBearishFvg = processedFvgs.isLastCandleDiscardBearishFvg;
    }
  }

  getLastIfvgDirection(): OrderDirection {
    if (!this.bullishIFvgArray.length) {
      return OrderDirection.sell;
    } else if (!this.bearishIFvgArray.length) {
      return OrderDirection.buy;
    }

    return this.bullishIFvgArray[this.bullishIFvgArray.length - 1]?.x > this.bearishIFvgArray[this.bearishIFvgArray.length - 1]?.x
      ? OrderDirection.buy
      : OrderDirection.sell;
  }

  getLastIfvg(): FVG {
    if (!this.bullishIFvgArray.length) {
      return this.bearishIFvgArray[this.bullishIFvgArray.length - 1];
    } else if (!this.bearishIFvgArray.length) {
      return this.bullishIFvgArray[this.bullishIFvgArray.length - 1];
    }

    return this.bullishIFvgArray[this.bullishIFvgArray.length - 1]?.x > this.bearishIFvgArray[this.bearishIFvgArray.length - 1]?.x
      ? this.bullishIFvgArray[this.bullishIFvgArray.length - 1]
      : this.bearishIFvgArray[this.bearishIFvgArray.length - 1];
  }
}

import { CandleChartData } from '../../interfaces/charts/candlestick-chart-data';
import { OrderDirection } from '../../strategy/enum/order-direction.enum';
import { FVG } from '../interfaces/fvg';
import { filterFvgArrays, filterInverseFvgArrays, getFvgElement } from './fvg-element';

export function calculateFVG(chartData: CandleChartData[]) {
  let bullishFvgArray: FVG[] = [];
  let bullishIFvgArray: FVG[] = [];
  let bearishFvgArray: FVG[] = [];
  let bearishIFvgArray: FVG[] = [];

  let isLastCandleDiscardBullishFvg: boolean = false;
  let isLastCandleDiscardBearishFvg: boolean = false;

  for (let i = 0; i < chartData.length; i++) {
    if (i > 2) {
      const fvgElement = getFvgElement(i, chartData[i], chartData[i - 2]);
      if (fvgElement.bullish !== null) {
        bullishFvgArray.push(fvgElement.bullish);
      }
      if (fvgElement.bearish !== null) {
        bearishFvgArray.push(fvgElement.bearish);
      }
      const processedFvgs = filterFvgArrays(
        chartData[i].open,
        chartData[i].close,
        bullishFvgArray,
        bearishFvgArray
      );

      bullishFvgArray = processedFvgs.newBullishFvg;
      bearishFvgArray = processedFvgs.newBearishFvg;

      bullishIFvgArray = [...bullishIFvgArray, ...processedFvgs.newInverseBullishFvg];
      bearishIFvgArray = [...bearishIFvgArray, ...processedFvgs.newInverseBearishFvg];

      const { newInverseBullishFvg, newInverseBearishFvg } = filterInverseFvgArrays(
        chartData[i].open,
        chartData[i].close,
        bullishIFvgArray,
        bearishIFvgArray
      );

      bullishIFvgArray = newInverseBullishFvg;
      bearishIFvgArray = newInverseBearishFvg;

      if (i === chartData.length - 1) {
        isLastCandleDiscardBullishFvg = processedFvgs.isLastCandleDiscardBullishFvg;
        isLastCandleDiscardBearishFvg = processedFvgs.isLastCandleDiscardBearishFvg;
      }
    }
  }

  return {
    FVGs: [...bullishFvgArray, ...bearishFvgArray],
    bullishIFVGs: bullishIFvgArray,
    bearishIFVGs: bearishIFvgArray,
    lastIFVG: getLastIfvg(bullishIFvgArray, bearishIFvgArray),
    lastIFVGDirection: getLastIfvgDirection(bullishIFvgArray, bearishIFvgArray),
    bullishIfvgOccurs: isLastCandleDiscardBearishFvg,
    bearishIfvgOccurs: isLastCandleDiscardBullishFvg,
  }
}

function getLastIfvgDirection(bullishIFvgArray: FVG[], bearishIFvgArray: FVG[]): OrderDirection {
  if (!bullishIFvgArray.length) {
    return OrderDirection.sell;
  } else if (!bearishIFvgArray.length) {
    return OrderDirection.buy;
  }

  return bullishIFvgArray[bullishIFvgArray.length - 1]?.x > bearishIFvgArray[bearishIFvgArray.length - 1]?.x
    ? OrderDirection.buy
    : OrderDirection.sell;
}

function getLastIfvg(bullishIFvgArray: FVG[], bearishIFvgArray: FVG[]): FVG {
  if (!bullishIFvgArray.length) {
    return bearishIFvgArray[bullishIFvgArray.length - 1];
  } else if (!bearishIFvgArray.length) {
    return bullishIFvgArray[bullishIFvgArray.length - 1];
  }

  return bullishIFvgArray[bullishIFvgArray.length - 1]?.x > bearishIFvgArray[bearishIFvgArray.length - 1]?.x
    ? bullishIFvgArray[bullishIFvgArray.length - 1]
    : bearishIFvgArray[bearishIFvgArray.length - 1];
}

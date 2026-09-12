import { differenceInMinutes, startOfDay } from 'date-fns';
import { CandleChartData } from '../../interfaces/charts/candlestick-chart-data';
import { ScriptVar } from './script-var';

export class TA {
  static highest(length: number, chartData: CandleChartData[], currentBarIndex: number): number {
    const arr: number[] = [];
    for (let i = currentBarIndex - 1; i > currentBarIndex - length; i--) {
      arr.push(chartData[i].high);
    }
    return Math.max(...arr);
  }

  static lowest(length: number, chartData: CandleChartData[], currentBarIndex: number): number {
    const arr: number[] = [];
    for (let i = currentBarIndex - 1; i > currentBarIndex - length; i--) {
      arr.push(chartData[i].low);
    }
    return Math.min(...arr);
  }

  static crossover(source1: ScriptVar<number>, source2: ScriptVar<number> | number): boolean {
    if (isNumber(source2)) {
      return source1.get(1) < source2 && source1.get() > source2;
    } else {
      return source1.get(1) < source2.get() && source1.get() > source2.get();
    }
  }

  static crossunder(source1: ScriptVar<number>, source2: ScriptVar<number> | number): boolean {
    if (isNumber(source2)) {
      return source1.get(1) > source2 && source1.get() < source2;
    } else {
      return source1.get(1) > source2.get() && source1.get() < source2.get();
    }
  }

  static pivothigh(
    data: CandleChartData[],
    leftBars: number,
    rightBars: number,
    index: number
  ): number | undefined {
    if (index >= data.length - rightBars || index < leftBars) {
      return undefined;
    }

    const leftRange: number[] = data.slice(index - leftBars, index).map(candle => candle.high);
    const rightRange: number[] = data
      .slice(index + 1, index + rightBars + 1)
      .map(candle => candle.high);
    if (Math.max(...leftRange) < data[index].high && Math.max(...rightRange) < data[index].high) {
      return data[index].high;
    }
  }

  static pivotlow(
    data: CandleChartData[],
    leftBars: number,
    rightBars: number,
    index: number
  ): number | undefined {
    if (index >= data.length - rightBars || index < leftBars) {
      return undefined;
    }

    const leftRange: number[] = data.slice(index - leftBars, index).map(candle => candle.low);
    const rightRange: number[] = data
      .slice(index + 1, index + rightBars + 1)
      .map(candle => candle.low);
    if (Math.min(...leftRange) > data[index].low && Math.min(...rightRange) > data[index].low) {
      return data[index].low;
    }
  }

  public static stddev(values: ScriptVar<number>, length: number): number {
    // take the last `length` values
    const data = values.slice(-length);

    const mean = data.reduce((a, b) => a + b) / data.length;
    const variance =
      data.reduce((total, value) => total + Math.pow(value - mean, 2), 0) / data.length;

    return Math.sqrt(variance);
  }
}

function isNumber(value: ScriptVar<number> | number): value is number {
  return typeof value === 'number';
}


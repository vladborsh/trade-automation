import { TrendOscillator } from '../enums';
import { TA } from '../tools/tech-analysis';
import { ScriptVar } from '../tools/script-var';
import { CandleChartData } from '../../interfaces/charts/candlestick-chart-data';

export class Swings {
  private currOscillator: TrendOscillator;
  private prevOscillator: TrendOscillator;

  constructor(
    private length: number,
    private chartData: CandleChartData[],
    private high: ScriptVar<number>,
    private low: ScriptVar<number>
  ) {
    this.currOscillator = TrendOscillator.LOWER;
    this.prevOscillator = TrendOscillator.LOWER;
  }

  calculate(iteration: number): [number, number] {
    const upper = TA.highest(this.length, this.chartData, iteration);
    const lower = TA.lowest(this.length, this.chartData, iteration);

    if (this.high.get(this.length) > upper) {
      this.currOscillator = TrendOscillator.HIGHER;
    } else if (this.low.get(this.length) < lower) {
      this.currOscillator = TrendOscillator.LOWER;
    } else {
      this.currOscillator = this.prevOscillator;
    }

    const top =
      this.currOscillator == TrendOscillator.HIGHER && this.prevOscillator != TrendOscillator.HIGHER
        ? this.high.get(this.length)
        : 0;
    const btm =
      this.currOscillator == TrendOscillator.LOWER && this.prevOscillator != TrendOscillator.LOWER
        ? this.low.get(this.length)
        : 0;
    this.prevOscillator = this.currOscillator;

    return [top, btm];
  }
}

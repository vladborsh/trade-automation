import { ScriptVar } from '../tools/script-var';
import { TA } from '../tools/tech-analysis';

export class TopSweep {
  constructor(
    private h_top_y: ScriptVar<number>,
    private top_y: ScriptVar<number>,
    private itop_y: ScriptVar<number>,
    private close: ScriptVar<number>,
    private open: ScriptVar<number>,
    private high: ScriptVar<number>
  ) {}

  calculate(): boolean {
    const SWEEP_MAX_LENGTH = 8;

    if (TA.crossunder(this.close, this.top_y.get())) {
      for (let i = 0; i <= SWEEP_MAX_LENGTH; i++) {
        if (
          this.close.get(i + 1) < this.top_y.get() &&
          this.close.get(i) > this.top_y.get() &&
          this.isCandleBigger(0, i)
        ) {
          return true;
        }
      }
    }

    if (TA.crossunder(this.close, this.itop_y.get())) {
      for (let i = 0; i <= SWEEP_MAX_LENGTH; i++) {
        if (
          this.close.get(i + 1) < this.itop_y.get() &&
          this.close.get(i) > this.itop_y.get() &&
          this.isCandleBigger(0, i)
        ) {
          return true;
        }
      }
    }

    if (TA.crossunder(this.close, this.h_top_y.get())) {
      for (let i = 0; i <= SWEEP_MAX_LENGTH; i++) {
        if (
          this.close.get(i + 1) > this.h_top_y.get() &&
          this.close.get(i) < this.h_top_y.get() &&
          this.isCandleBigger(0, i)
        ) {
          return true;
        }
      }
    }

    if (
      this.close.get() < this.open.get() &&
      this.high.get(1) > this.high.get() &&
      this.high.get(1) > this.high.get(2) &&
      this.close.get(1) > this.close.get(2) &&
      this.isBullishCandle(2) &&
      this.close.get() < this.open.get(2)
    ) {
      return true;
    }

    /* bearish pin bar */
    if (
      this.close.get() < this.open.get() &&
      Math.abs(this.open.get() - this.high.get()) > Math.abs(this.close.get() - this.open.get()) &&
      this.high.get() > this.high.get(1) &&
      this.high.get() > this.high.get(2)
    ) {
      return true;
    }


    /* three candle formation */
    if (
      this.close.get() < this.open.get() &&
      this.high.get() > this.high.get(1) &&
      this.isBullishCandle(1) &&
      this.isCandleBigger(0, 1)
    ) {
      return true;
    }

    return false;
  }

  isCandleBigger(index1: number, index2: number): boolean {
    const size1 = Math.abs(this.open.get(index1) - this.close.get(index1));
    const size2 = Math.abs(this.open.get(index2) - this.close.get(index2));

    return size1 > size2;
  }

  isBullishCandle(index: number): boolean {
    return this.close.get(index) > this.open.get(index);
  }
}

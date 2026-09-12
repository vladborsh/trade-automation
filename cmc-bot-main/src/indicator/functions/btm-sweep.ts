import { ScriptVar } from '../tools/script-var';
import { TA } from '../tools/tech-analysis';

export class BtmSweep {
  constructor(
    private h_btm_y: ScriptVar<number>,
    private btm_y: ScriptVar<number>,
    private ibtm_y: ScriptVar<number>,
    private close: ScriptVar<number>,
    private open: ScriptVar<number>,
    private low: ScriptVar<number>
  ) {}

  calculate(): boolean {
    const SWEEP_MAX_LENGTH = 8;

    if (TA.crossover(this.close, this.btm_y.get())) {
      for (let i = 0; i <= SWEEP_MAX_LENGTH; i++) {
        if (
          this.close.get(i + 1) > this.btm_y.get() &&
          this.close.get(i) < this.btm_y.get() &&
          this.isCandleBigger(0, i)
        ) {
          return true;
        }
      }
    }

    if (TA.crossover(this.close, this.ibtm_y.get())) {
      for (let i = 0; i <= SWEEP_MAX_LENGTH; i++) {
        if (
          this.close.get(i + 1) > this.ibtm_y.get() &&
          this.close.get(i) < this.ibtm_y.get() &&
          this.isCandleBigger(0, i)
        ) {
          return true;
        }
      }
    }

    if (TA.crossover(this.close, this.h_btm_y.get())) {
      for (let i = 0; i <= SWEEP_MAX_LENGTH; i++) {
        if (
          this.close.get(i + 1) > this.h_btm_y.get() &&
          this.close.get(i) < this.h_btm_y.get() &&
          this.isCandleBigger(0, i)
        ) {
          return true;
        }
      }
    }

    if (
      this.close.get() > this.open.get() &&
      this.low.get(1) < this.low.get() &&
      this.low.get(1) < this.low.get(2) &&
      this.close.get(1) > this.close.get(2) &&
      this.isBearishCandle(2) &&
      this.close.get() > this.open.get(2)
    ) {
      return true;
    }

    /* bullish pin bar */
    if (
      this.close.get() > this.open.get() &&
      Math.abs(this.open.get() - this.low.get()) > Math.abs(this.close.get() - this.open.get()) &&
      this.low.get() < this.low.get(1) &&
      this.low.get() < this.low.get(2)
    ) {
      return true;
    }

    /* three candle formation */
    if (
      this.close.get() > this.open.get() &&
      this.low.get() < this.low.get(1) &&
      this.isBearishCandle(1) &&
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

  isBearishCandle(index: number = 0): boolean {
    return this.close.get(index) < this.open.get(index);
  }
}

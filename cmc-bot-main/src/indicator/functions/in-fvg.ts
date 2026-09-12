import { FVG } from '../interfaces/fvg';
import { ScriptVar } from '../tools/script-var';

export class InFVG {
  constructor(
    private getBullishFvg: () => FVG[],
    private getBearishFvg: () => FVG[],
    private close: ScriptVar<number>,
    private high: ScriptVar<number>,
    private low: ScriptVar<number>
  ) {}

  calculate(bearish: boolean): boolean {
    const HISTORY_SIZE = 5;
    const bullishFvg = this.getBullishFvg();
    const bearishFvg = this.getBearishFvg();
    if (bearish) {
      let foundFvgBear: FVG | undefined;

      for (let i = 0; i <= HISTORY_SIZE; i++) {
        foundFvgBear = bearishFvg.find((fvg) => this.close.get(i + 1) > fvg.low && this.close.get(i) < fvg.low);
        if (foundFvgBear) {
          break;
        }
        foundFvgBear = bearishFvg.find((fvg) => this.high.get(i + 1) < fvg.low && this.high.get(i) > fvg.low);
        if (foundFvgBear) {
          break;
        }
      }

      const containsClose = bearishFvg.find((fvg) => this.close.get() > fvg.low && this.close.get() < fvg.high);

      return !!foundFvgBear || !!containsClose;
    } else {
      let foundFvgBull: FVG | undefined;
      for (let i = 0; i <= HISTORY_SIZE; i++) {
        foundFvgBull = bullishFvg.find((fvg) => this.close.get(i + 1) < fvg.high && this.close.get(i) > fvg.high);
        if (foundFvgBull) {
          break;
        }
        foundFvgBull = bullishFvg.find((fvg) => this.low.get(i + 1) < fvg.high && this.low.get(i) > fvg.high);
        if (foundFvgBull) {
          break;
        }
      }

      const containsClose = bullishFvg.find((fvg) => this.close.get() > fvg.low && this.close.get() < fvg.high);

      return !!foundFvgBull || !!containsClose;
    }
  }
}

import { Nullable } from "../../types/types";
import { FVG } from "../interfaces/fvg";
import { ScriptVar } from "../tools/script-var";

export class InverseFVG {
  constructor(
    private getBullishFvg: () => FVG[],
    private getBearishFvg: () => FVG[],
    private close: ScriptVar<number>,
    private open: ScriptVar<number>,
  ) { }

  public calculate(): { bullish: Nullable<FVG>; bearish: Nullable<FVG> } {
    const HISTORY_SIZE = 20;

    let bullishIFVG: Nullable<FVG> = null;
    let bearishIFVG: Nullable<FVG> = null;

    const bullishFVGs = this.getBullishFvg();
    const bearishFVGs = this.getBearishFvg();

    const close = this.close.get();
    const open = this.open.get();

    for (let i = bearishFVGs.length - 1; (bearishFVGs.length - i) < HISTORY_SIZE && i >= 0; i--) {
      const priceCrossedUpperBound = open < bearishFVGs[i].high && close > bearishFVGs[i].high;

      if (priceCrossedUpperBound) {
        bullishIFVG = new FVG(bearishFVGs[i].low, bearishFVGs[i].high, bearishFVGs[i].x);
        break;
      }
    }

    for (let i = bullishFVGs.length - 1; (bullishFVGs.length - i) < HISTORY_SIZE && i >= 0; i--) {
      const priceCrossedLowerBound = open > bullishFVGs[i].low && close < bullishFVGs[i].low;

      if (priceCrossedLowerBound) {
        bearishIFVG = new FVG(bullishFVGs[i].low, bullishFVGs[i].high, bullishFVGs[i].x);
        break;
      }
    }

    return { bullish: bullishIFVG, bearish: bearishIFVG };
  }
}

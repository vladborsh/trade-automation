import { ScriptVar } from "../tools/script-var";

export class YinDiscount {
  constructor(
    private h_trail_up: ScriptVar<number>,
    private h_trail_dn: ScriptVar<number>,
    private trail_up: ScriptVar<number>,
    private trail_dn: ScriptVar<number>,
  ) {}

  calculate(y: number): {price_h_discount: boolean, price_discount: boolean} {
    const price_h_discount = 0.5 * this.h_trail_up.get() + 0.5 * this.h_trail_dn.get() > y;
    const price_discount = 0.5 * this.trail_up.get() + 0.5 * this.trail_dn.get() > y;

    return {price_h_discount, price_discount};
  }
}

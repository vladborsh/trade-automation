import { ScriptVar } from "../tools/script-var";

export class YinPremium {
  constructor(
    private h_trail_up: ScriptVar<number>,
    private h_trail_dn: ScriptVar<number>,
    private trail_up: ScriptVar<number>,
    private trail_dn: ScriptVar<number>,
  ) {}

  calculate(y: number): { price_h_premium: boolean; price_premium: boolean } {
    const price_h_premium = 0.5 * this.h_trail_up.get() + 0.5 * this.h_trail_dn.get() < y;
    const price_premium = 0.5 * this.trail_up.get() + 0.5 * this.trail_dn.get() < y;

    return { price_h_premium, price_premium };
  }
}

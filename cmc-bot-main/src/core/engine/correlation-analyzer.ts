import { DivergenceRule } from "../divergence/divergence-rule";
import { DivergenceMatch } from "../models/divergence-match";
import { TechnicalSnapshot } from "../models/technical-snapshot";

export class CorrelationAnalyzer {
  rules: DivergenceRule[] = [];

  findDivergences(left: TechnicalSnapshot[], right: TechnicalSnapshot[]): DivergenceMatch[] {
    return this.rules.reduce((acc, rule) => {
      const matches = rule.detect(left, right);
      return [...acc, ...matches];
    }, [] as DivergenceMatch[]);
  }
}

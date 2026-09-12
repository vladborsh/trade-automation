import { DivergenceMatch } from "../models/divergence-match";
import { TechnicalSnapshot } from "../models/technical-snapshot";

export interface DivergenceRule {
  detect(left: TechnicalSnapshot[], right: TechnicalSnapshot[]): DivergenceMatch[];
}

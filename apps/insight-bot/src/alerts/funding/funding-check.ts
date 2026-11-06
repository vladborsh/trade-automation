import type { FundingFacts, FundingSide } from '@trade-automation/contracts';
import { levelBand } from '../../insights/charts/chart-math';
import { fundingExtreme, fundingIntervalH, fundingPer8h, fundingSample } from '../../insights/funding-extreme';
import { levelRarity } from '../../insights/rarity';
import { RARITY_SHOW } from '../../insights/thresholds';

/**
 * IB-124 (design F2, F3, F8) — one coin's check, pure. Every judgement is IB-135's and R5's:
 * - sample: the coin's settled rates of the last 30 days, judged only when `fundingSample` accepts them;
 * - interval: `fundingIntervalH` (median of the last 3 spacings) over the same settlements' times;
 * - rarity: `levelRarity` (two-sided, around the median), recorded with R5's own band (`levelBand`);
 * - extreme: `fundingExtreme(rate, rarity, intervalH, floor)`; the floor defaults to `FUNDING_FLOOR_PER_8H`.
 * So the Market card, the table and the alert cannot disagree about one rate on one sample.
 *
 * The near-miss (F8) is a check that meets exactly ONE of the two conditions: `floor` when it is rare but inside the
 * floor, `band` when it is beyond the floor but not rare. Its side is the rate's sign.
 */
export interface FundingCheckInput {
  /** `premiumIndex.lastFundingRate`, as a number. */
  rate: number;
  rateTimeMs: number;
  nextFundingTimeMs: number;
  /** The coin's settled history, oldest first; `time` in unix seconds (WebFundingPoint). */
  settled: ReadonlyArray<{ time: number; rate: number }>;
  /** The coin's own floor, or the shared default. */
  floorPer8h: number;
}

export interface FundingCheck {
  facts: FundingFacts;
  extreme: FundingSide | null;
  nearMiss: { side: FundingSide; failed: 'floor' | 'band' } | null;
}

/** Null: too few settlements to judge (the same rule R5 uses). */
export function fundingCheck(x: FundingCheckInput): FundingCheck | null {
  const sample = fundingSample(x.settled);
  if (sample === null) return null;
  const rates = sample.map((p) => p.rate);
  const rarity = levelRarity(x.rate, rates) as number; // non-empty: fundingSample refused short samples
  const band = levelBand(rates, RARITY_SHOW) as { lo: number; hi: number };
  const intervalH = fundingIntervalH(sample.map((p) => p.time));
  const ratePer8h = fundingPer8h(x.rate, intervalH);
  const facts: FundingFacts = {
    rate: x.rate, intervalH, ratePer8h, rarity, band, sample: sample.length, floorPer8h: x.floorPer8h,
    rateTimeMs: x.rateTimeMs, nextFundingTimeMs: x.nextFundingTimeMs,
  };
  const extreme = fundingExtreme(x.rate, rarity, intervalH, x.floorPer8h);
  return { facts, extreme, nearMiss: extreme === null ? nearMissOf(rarity, ratePer8h, x.floorPer8h) : null };
}

function nearMissOf(rarity: number, ratePer8h: number, floor: number): FundingCheck['nearMiss'] {
  if (ratePer8h === 0) return null;
  const side: FundingSide = ratePer8h > 0 ? 'high' : 'low';
  const rare = rarity >= RARITY_SHOW;
  const beyondFloor = Math.abs(ratePer8h) >= floor;
  if (rare && !beyondFloor) return { side, failed: 'floor' };
  if (!rare && beyondFloor) return { side, failed: 'band' };
  return null;
}

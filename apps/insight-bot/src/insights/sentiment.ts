import { fearGreedZone, type FearGreedBand } from '@trade-automation/contracts';
/**
 * Fear & Greed bands as alternative.me defines them (0–24 extreme fear, 25–44 fear, 45–55 neutral,
 * 56–75 greed, 76–100 extreme greed). Shared by the KPI strip (IB-085) and rule R7 (IB-086).
 */
export function fngBand(value: number): FearGreedBand {
  // IB-102: the one table in contracts, which the dashboard's colours, words and gauge also read
  return fearGreedZone(value);
}

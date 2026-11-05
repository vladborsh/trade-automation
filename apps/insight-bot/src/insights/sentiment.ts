import { fearGreedZone, type FearGreedBand } from '@trade-automation/contracts';
/**
 * Fear & Greed bands as alternative.me defines them (0–24 extreme fear, 25–44 fear, 45–55 neutral,
 * 56–75 greed, 76–100 extreme greed). Used by rule R7 (IB-086); the KPI strip used it until IB-117 dropped the F&G tile.
 */
export function fngBand(value: number): FearGreedBand {
  // IB-102: the one table in contracts, which the dashboard's colours, words and gauge also read
  return fearGreedZone(value);
}

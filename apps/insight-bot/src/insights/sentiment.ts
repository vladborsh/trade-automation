/**
 * Fear & Greed bands as alternative.me defines them (0–24 extreme fear, 25–44 fear, 45–55 neutral,
 * 56–75 greed, 76–100 extreme greed). Shared by the KPI strip (IB-085) and rule R7 (IB-086).
 */
export function fngBand(value: number): 'extreme_fear' | 'fear' | 'neutral' | 'greed' | 'extreme_greed' {
  if (value <= 24) return 'extreme_fear';
  if (value <= 44) return 'fear';
  if (value <= 55) return 'neutral';
  if (value <= 75) return 'greed';
  return 'extreme_greed';
}

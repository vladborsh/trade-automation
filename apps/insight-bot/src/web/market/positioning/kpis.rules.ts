/**
 * IB-085 (D10) — the KPI tiles' context words, pure. The client words them (D4); these decide
 * which word. The F&G bands are alternative.me's own (0–24 extreme fear, 25–44 fear, 45–55 neutral,
 * 56–75 greed, 76–100 extreme greed — the classification its API returns beside the value).
 */
export function fngBand(value: number): 'extreme_fear' | 'fear' | 'neutral' | 'greed' | 'extreme_greed' {
  if (value <= 24) return 'extreme_fear';
  if (value <= 44) return 'fear';
  if (value <= 55) return 'neutral';
  if (value <= 75) return 'greed';
  return 'extreme_greed';
}

/** Which side dominated the liquidations, and its share in whole percent. */
export function liqSide(long: number, short: number): { side: 'long' | 'short'; sharePct: number } {
  const total = long + short;
  const side = long >= short ? 'long' : 'short';
  return { side, sharePct: total > 0 ? Math.round(((side === 'long' ? long : short) / total) * 100) : 0 };
}

/** Positive funding: longs pay shorts. Exactly 0 is "flat". */
export function fundingSide(rate: number): 'longs_pay' | 'shorts_pay' | 'flat' {
  if (rate > 0) return 'longs_pay';
  if (rate < 0) return 'shorts_pay';
  return 'flat';
}

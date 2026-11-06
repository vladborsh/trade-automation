/** IB-129 — journal `details` that parse as their event's contract; shared by the unit and the DB spec. */
export const AT = new Date(Date.UTC(2026, 10, 5, 12, 0, 0));

export const liqDetails = {
  side: 'long', windowStartMs: AT.getTime() - 300_000, sumUsd: 7.4e6, thresholdUsd: 5e6,
  byVenue: { binance: 3.1e6, bybit: 2.9e6, okx: 1.4e6 }, count: 120, largest: { usd: 1.2e6, venue: 'bybit' },
  silentVenues: [], binanceFootnote: false,
};
const facts = {
  rate: 0.0004, intervalH: 4, ratePer8h: 0.0008, rarity: 0.98, band: { lo: -0.0001, hi: 0.0003 }, sample: 180,
  floorPer8h: 0.0003, rateTimeMs: 1, nextFundingTimeMs: 2,
};
export const enterDetails = { ...facts, side: 'high', episodeStartMs: AT.getTime() };
export const flipDetails = { ...facts, side: 'high', episodeStartMs: 1, episodeEndMs: 2, episodeHours: 31.5, flipSinceMs: AT.getTime() };


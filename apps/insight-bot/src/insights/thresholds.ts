/**
 * The market page's judgement numbers (architecture/market-page-design-2026-11-03.md D2, D5 R3,
 * D8, D14) — in ONE file because they are judgements, not measurements: revisit them after the box
 * has a week of its own data. IB-084 uses the liquidation ones; IB-086's rules import the rest.
 */

/** D2: a statement (and an hourly outlier bar) is shown only at or above this rarity. */
export const RARITY_SHOW = 0.9;

/** D5 R3 — a cascade: at least this many same-side events … */
export const SERIES_MIN_EVENTS = 3;
/** … each at least this big, in USD … */
export const SERIES_MIN_USD = 100_000;
/** … first to last within this many seconds ("4 за 9 минут" is one; "3 за 11 минут" is not). */
export const SERIES_MAX_SPAN_SEC = 600;

/** D8: the "large" list's floor, in USD, and how many events it returns. */
export const LARGE_MIN_USD = 100_000;
export const LARGE_LIMIT = 50;

/** D8: the liquidation block's server cache, per period. */
export const LIQUIDATION_BLOCK_CACHE_MS = 5_000;

// ---- IB-085 positioning (D9) and KPIs (D10) ---------------------------------------------------

/** D3: a cell's rarity needs at least this many days of the coin's own history. */
export const POSITIONING_MIN_HISTORY_DAYS = 20;
/** The baseline history every cell's rarity is measured against. */
export const POSITIONING_BASELINE_DAYS = 30;
/** D9 quadrant: |price change| below this percent is "flat" … */
export const PRICE_FLAT_PCT = 0.5;
/** … and |OI change| below this percent is "flat". */
export const OI_FLAT_PCT = 1;
/** D9: baselines (klines 1h × 720, funding history, OI/LS 1h) are rebuilt hourly … */
export const POSITIONING_BASELINE_CACHE_MS = 60 * 60_000;
/** … the current values every minute; the KPI strip too (D10). */
export const POSITIONING_CURRENT_CACHE_MS = 60_000;
export const KPI_CACHE_MS = 60_000;
/** "quiet": every measured cell under this rarity, and at least this many measured. */
export const QUIET_MAX_RARITY = 0.5;
export const QUIET_MIN_CELLS = 3;

// ---- IB-086 «Главное сейчас» (D1–D5, D15) -----------------------------------------------------

/** D1: how many statements the page shows. */
export const INSIGHTS_TOP_N = 5;
/** D3: the liquidation rules need this many days of our own tape; OI/funding/price/L-S rules 20 days. */
export const LIQ_RULE_MIN_DAYS = 7;
export const VENUE_RULE_MIN_DAYS = 20;
/** R2: a coin below this USD over the period cannot top "most unusual" (a $40k alt is not news). */
export const R2_MIN_USD = 250_000;
/** D13: the insights endpoint's cache. */
export const INSIGHTS_CACHE_MS = 60_000;

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

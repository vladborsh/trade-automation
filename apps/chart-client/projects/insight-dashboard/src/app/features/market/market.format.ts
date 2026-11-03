/**
 * IB-037 (§12.1) — how the market cards' numbers are written down.
 *
 * Pure, beside the component, and spec'd, because a card's whole job is the formatting: the server
 * sends the figures and their basis, and the only thing that can go wrong here is printing a number
 * in a way a reader will misread.
 *
 * Two rules run through all of it:
 *
 * - **A figure a card cannot have returns `null`, never `0` and never `—` dressed as a value.** The
 *   template turns `null` into «нет данных» in words, which is a different claim from "no change".
 * - **A unit is never implied.** A dominance delta is percentage *points*, a cap is dollars at a
 *   stated scale; the suffix is part of the number, not decoration.
 */

/** The typographic minus (U+2212), not a hyphen: it lines up under a `+` in a column of deltas. */
const MINUS = '−';

/**
 * A signed change — `+2.14`, `${MINUS}0.30`, `0.00`.
 *
 * The caller's string says what the unit is (percentage points for the dominance cards, percent for
 * the cap table), because the same formatting serves both and only the sentence knows which.
 */
export function signed(value: number | null | undefined, digits = 2): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const body = Math.abs(value).toFixed(digits);
  return `${value < 0 ? MINUS : '+'}${body}`;
}

/** A plain percentage with its sign dropped — `72.14`. The `%` belongs to the template. */
export function percent(value: number | null | undefined, digits = 2): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value.toFixed(digits);
}

/** A 0..1 fractional change as a signed percentage — the caps table's 24 h and 7 d columns. */
export function fractionSigned(value: number | null | undefined, digits = 2): string | null {
  return value === null || value === undefined ? null : signed(value * 100, digits);
}

/**
 * A market cap at the scale it is quoted in — `$2.41T`, `$412B`, `$8.3B`.
 *
 * The whole-market cap is trillions and a top-20 coin's is billions, so a fixed unit would print
 * either `$2412B` or `$0.01T`. The scale is in the string, which is the point: a bare `2.41` on a
 * card is unreadable, and a card is read at a glance or not at all.
 */
export function capUsd(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const sign = value < 0 ? MINUS : '';
  const n = Math.abs(value);
  if (n >= 1e12) return `${sign}$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${sign}$${(n / 1e9).toFixed(n / 1e9 >= 100 ? 0 : 1)}B`;
  if (n >= 1e6) return `${sign}$${(n / 1e6).toFixed(1)}M`;
  return `${sign}$${Math.round(n)}`;
}

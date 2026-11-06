import type {
  WebPositioningCell, WebPositioningQuadrant, WebPositioningSignal,
} from '@trade-automation/contracts';
import { fundingExtreme } from '../../../insights/funding-extreme';
import { changeRarity, levelRarity } from '../../../insights/rarity';
import { OI_FLAT_PCT, PRICE_FLAT_PCT, QUIET_MAX_RARITY, QUIET_MIN_CELLS, RARITY_SHOW } from '../../../insights/thresholds';

/**
 * IB-085 (market-page design D2, D3, D9) — the positioning table's rules, pure, each with a spec.
 *
 * **Rarity is two-sided** so every cell sorts on one scale: how far the current figure is from
 * typical, as the mid-rank percentile of |deviation| within the coin's own history — |change| for a
 * change (a +5 % and a −5 % hour are equally unusual), |level − median| for a level (funding, L/S).
 * The sign stays in `value`.
 *
 * **Signals — the closed vocabulary (contract `WEB_POSITIONING_SIGNALS`), first match wins:**
 * - `squeeze` — quadrant `short_closing` (price up, OI down: shorts forced out) and the price move
 *   rare (rarity ≥ 0.90).
 * - `capitulation` — quadrant `long_closing` (price down, OI down: longs forced out) and the price
 *   move rare.
 * - `crowded_long` — funding `high` by `fundingExtreme` (rare for the coin AND ≥ +0.03 % per 8 h,
 *   IB-135), and the global account L/S above 1 AND rare.
 * - `crowded_short` — funding `low` (rare AND ≤ −0.03 % per 8 h), and the global L/S below 1 AND rare.
 * - `quiet` — at least 3 cells measured and every measured rarity under 0.5.
 * - otherwise null: the row has nothing worth a word.
 * Thresholds live in `insights/thresholds.ts` — judgements, revisited after a week of box data.
 */

/** A cell with a value and a rarity, or the stated reason one is missing. Never a 0 for "unknown". */
export function cell(
  value: number | null,
  sample: readonly number[] | null,
  measure: (value: number, sample: readonly number[]) => number | null,
  why: WebPositioningCell['unavailable'] = null,
): WebPositioningCell {
  if (value === null) return { value: null, rarity: null, unavailable: why ?? 'venue_unavailable', sample: 0 };
  if (sample === null) return { value, rarity: null, unavailable: why ?? 'insufficient_history', sample: 0 };
  const r = measure(value, sample);
  return { value, rarity: r, unavailable: r === null ? 'insufficient_history' : null, sample: sample.length };
}

/**
 * IB-BUG-037: a cell this period NEVER rates (a 7d change, 7d liquidations — 30 days hold four 7-day
 * windows), however long the history: `not_rated_at_period`, not «under 20 days». No value still
 * says the venue did not answer.
 */
export function unratedCell(value: number | null): WebPositioningCell {
  if (value === null) return cell(null, null, () => null);
  return { value, rarity: null, unavailable: 'not_rated_at_period', sample: 0 };
}

export { changeRarity, levelRarity } from '../../../insights/rarity';

/** Percent changes over `steps` positions, for every position that has a predecessor that far back. */
export function rollingChangesPct(values: readonly number[], steps: number): number[] {
  const out: number[] = [];
  for (let i = steps; i < values.length; i++) {
    const before = values[i - steps] as number;
    if (before > 0) out.push(((values[i] as number) / before - 1) * 100);
  }
  return out;
}

/**
 * D9 quadrant from the SIGNS of the period's changes. OI decides opening vs closing; price decides
 * which side. **With a flat price and a moving OI the side is read from funding** — who pays is who
 * is crowding in (or out) — so a coin whose OI rose 26 % on a flat price is not called "flat".
 * OI within its flat band → `flat` (nobody is opening or closing in size, whatever the price did).
 */
export function quadrantOf(pricePct: number | null, oiPct: number | null, funding: number | null): WebPositioningQuadrant | null {
  if (pricePct === null || oiPct === null) return null;
  if (Math.abs(oiPct) < OI_FLAT_PCT) return 'flat';
  const opening = oiPct > 0;
  let up: boolean | null = Math.abs(pricePct) >= PRICE_FLAT_PCT ? pricePct > 0 : null;
  if (up === null) {
    if (funding === null || funding === 0) return 'flat';
    // opening: longs paying = longs crowding in; closing: longs paying = longs leaving
    up = opening ? funding > 0 : funding < 0;
  }
  if (opening) return up ? 'new_longs' : 'new_shorts';
  return up ? 'short_closing' : 'long_closing';
}

export function signalOf(row: {
  quadrant: WebPositioningQuadrant | null;
  priceChangePct: WebPositioningCell;
  fundingRate: WebPositioningCell;
  /** IB-135: the coin's settlement interval (h), to normalise funding to 8 h; null counts as 8 h. */
  fundingIntervalH: number | null;
  lsGlobal: WebPositioningCell;
  cells: readonly WebPositioningCell[];
}): WebPositioningSignal | null {
  const rare = (c: WebPositioningCell) => c.rarity !== null && c.rarity >= RARITY_SHOW;
  if (row.quadrant === 'short_closing' && rare(row.priceChangePct)) return 'squeeze';
  if (row.quadrant === 'long_closing' && rare(row.priceChangePct)) return 'capitulation';
  // IB-135: the same helper as R5, so the table cannot call «толпа в лонгах» what the card stays silent on
  const funding = fundingExtreme(row.fundingRate.value, row.fundingRate.rarity, row.fundingIntervalH);
  const ls = row.lsGlobal.value;
  if (funding !== null && ls !== null && rare(row.lsGlobal)) {
    if (funding === 'high' && ls > 1) return 'crowded_long';
    if (funding === 'low' && ls < 1) return 'crowded_short';
  }
  const measured = row.cells.filter((c) => c.rarity !== null);
  if (measured.length >= QUIET_MIN_CELLS && measured.every((c) => (c.rarity as number) < QUIET_MAX_RARITY)) return 'quiet';
  return null;
}

import type { WebDexFieldPresence } from '@trade-automation/contracts';

/**
 * IB-028 — pure display helpers for the GoPlus field-presence block.
 *
 * **Why a rate and not an alarm on one absence.** GoPlus's EVM payload varies per token: two real
 * responses share only 5 of 29 field names. So a field missing from one response is normal and
 * carries no information, while a field that was answered for most tokens and is now answered for
 * none is a shape change. The signal exists only in the aggregate, which is why this block shows a
 * denominator next to every rate — a 0 % over 2 asks is noise and a 0 % over 400 is an outage.
 *
 * Three states kept apart, because only one is anybody's work:
 *
 * - **gone** — declared always-present, and not one answered ask carried it. The alarm.
 * - **thin** — fewer answered asks than `MIN_ASKS_FOR_A_RATE`, so no claim is possible yet. Not a
 *   zero: "we have not asked enough" and "the venue stopped sending it" are different facts, and
 *   showing the first as the second is the defect this whole task has been about.
 * - **varies** — an optional field, absent for some tokens. Expected, measured, never an alarm.
 */

/**
 * Below this many answered asks the block states no rate.
 *
 * Five, matching AGENTS.md's repetition rule: the rule exempts payload shapes on the grounds that
 * a shape does not drift, and GoPlus falsifies that premise for itself, so a presence claim here
 * needs the same evidence as a number.
 */
export const MIN_ASKS_FOR_A_RATE = 5;

export type DexFieldState = 'gone' | 'thin' | 'varies' | 'ok';

export interface DexFieldView extends WebDexFieldPresence {
  /** '38 of 40', so the denominator is never out of sight. */
  presentLabel: string;
  /** '95 %', or '—' when there is no rate to state. */
  rateLabel: string;
  state: DexFieldState;
}

function state(row: WebDexFieldPresence): DexFieldState {
  if (row.answered < MIN_ASKS_FOR_A_RATE) return 'thin';
  if (row.presence === 'always' && row.present === 0) return 'gone';
  if (row.present < row.answered) return 'varies';
  return 'ok';
}

const RANK: Readonly<Record<DexFieldState, number>> = { gone: 0, varies: 1, thin: 2, ok: 3 };

export function toDexFieldViews(rows: readonly WebDexFieldPresence[]): DexFieldView[] {
  return rows
    .map((row) => ({
      ...row,
      presentLabel: `${row.present} of ${row.answered}`,
      // null means no answered asks at all; a '0 %' there would state a measurement never made
      rateLabel: row.presentRate === null || row.answered < MIN_ASKS_FOR_A_RATE
        ? '—'
        : `${Math.round(row.presentRate * 100)} %`,
      state: state(row),
    }))
    .sort((a, b) => RANK[a.state] - RANK[b.state]
      || a.chainFamily.localeCompare(b.chainFamily)
      || a.field.localeCompare(b.field));
}

/** The one figure the block exists to surface, plus whether a claim is possible at all. */
export function dexFieldTotals(rows: readonly WebDexFieldPresence[]): {
  fields: number;
  gone: number;
  /** Fields with enough answered asks to state a rate for. */
  measured: number;
  answered: number;
} {
  const views = toDexFieldViews(rows);
  return {
    fields: rows.length,
    gone: views.filter((v) => v.state === 'gone').length,
    measured: views.filter((v) => v.state !== 'thin').length,
    // the largest population behind any single field, which is what "we have asked enough" means
    answered: rows.reduce((max, r) => Math.max(max, r.answered), 0),
  };
}

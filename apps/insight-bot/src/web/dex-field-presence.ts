import type { WebDexFieldPresence } from '@trade-automation/contracts';
import { FIELD_CONTRACTS, type ChainFamily } from '../dex/goplus';

/**
 * IB-028 — counted asks into the per-field presence rate the coverage page shows. Pure.
 *
 * Two rules, both of them the day's distinction:
 *
 * - **A field that belongs to the other family is dropped, not shown as 0 %.** `buy_tax` is not
 *   absent from a Solana response, it is not applicable to one, and a 0 % there would read as a
 *   field that vanished.
 * - **`presentRate` is null when nothing was answered**, never 0. No asks answered and every ask
 *   answered without the field are different facts, and the second is the alarm.
 */
export function dexFieldPresence(
  counted: ReadonlyArray<{ chainFamily: string; field: string; answered: number; present: number }>,
): WebDexFieldPresence[] {
  const out: WebDexFieldPresence[] = [];
  for (const family of ['solana', 'evm'] as const) {
    for (const contract of FIELD_CONTRACTS[family]) {
      const row = counted.find((c) => c.chainFamily === family && c.field === contract.field);
      const answered = row?.answered ?? 0;
      const present = row?.present ?? 0;
      out.push({
        chainFamily: family,
        field: contract.field,
        answered,
        present,
        presentRate: answered === 0 ? null : present / answered,
        presence: contract.presence,
        // carried through so the page can explain a 100 % field that is still optional; see the
        // contract's comment on `evidence`
        evidence: contract.evidence,
      });
    }
  }
  return out;
}

/** The union of both families' fields, for the one query that counts them. */
export const ALL_GOPLUS_FIELDS: readonly string[] = [
  ...new Set((['solana', 'evm'] as ChainFamily[]).flatMap((f) => FIELD_CONTRACTS[f].map((c) => c.field))),
];

/**
 * Days of per-field history that would justify wiring an alarm to these rates.
 *
 * **The deferral has a condition for its removal, and that is the point of the number.** "Pending
 * enough history" with no horizon becomes never, and a deliberate absence without a removal
 * condition is indistinguishable from an omission six months later — the reader cannot tell whether
 * to act. Fourteen matches the discipline used elsewhere this week, and `baselineProgress` reports
 * how far each field has got, so the condition is measurable rather than merely stated.
 *
 * What the alarm would then be: **below this field's own observed floor, over a population of at
 * least `MIN_ASKS_FOR_A_RATE` answered asks.** Not a fixed percentage — `metadata_mutable` sits
 * near 92 % legitimately while `mintable` sits at 100 %, so one threshold across fields would
 * either miss the first or cry about the second.
 */
export const BASELINE_DAYS_REQUIRED = 14;

export interface BaselineProgress {
  chainFamily: string;
  field: string;
  /** Distinct UTC days with at least one answered ask. */
  days: number;
  /** The lowest daily rate seen — "has this field ever been missing", which a mean would hide. */
  floor: number | null;
  ready: boolean;
}

/**
 * How much baseline each field has, from the per-day series.
 *
 * The floor rather than the mean, deliberately: a mean hides a bad day, and the question this
 * detector exists to answer is exactly "has this field ever stopped arriving".
 */
export function baselineProgress(
  byDay: ReadonlyArray<{ day: string; chainFamily: string; field: string; answered: number; present: number }>,
): BaselineProgress[] {
  const seen = new Map<string, { days: Set<string>; rates: number[] }>();
  for (const row of byDay) {
    if (row.answered === 0) continue;
    const key = `${row.chainFamily}:${row.field}`;
    const entry = seen.get(key) ?? { days: new Set<string>(), rates: [] };
    entry.days.add(row.day);
    entry.rates.push(row.present / row.answered);
    seen.set(key, entry);
  }
  return [...seen].map(([key, entry]) => {
    const [chainFamily, field] = key.split(':');
    return {
      chainFamily,
      field,
      days: entry.days.size,
      floor: entry.rates.length === 0 ? null : Math.min(...entry.rates),
      ready: entry.days.size >= BASELINE_DAYS_REQUIRED,
    };
  }).sort((a, b) => a.chainFamily.localeCompare(b.chainFamily) || a.field.localeCompare(b.field));
}


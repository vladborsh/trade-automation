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

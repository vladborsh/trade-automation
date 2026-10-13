import { numberOrNull } from './mappers';

/**
 * IB-028 — GoPlus token security into a row, for both response shapes (§10).
 *
 * ## Why this file asserts PRESENCE rather than trusting the payload
 *
 * My first schema took `is_honeypot`, `is_proxy` and `owner_can_change_balance` from GoPlus's
 * documentation. **None of the three appears in either real response.** The docs described an API
 * that does not exist for these chains, and no fixture written against our own expectations would
 * have caught it — only a live call did.
 *
 * Removing those three fixed today's error and left the mechanism intact: a field we DO read could
 * vanish tomorrow, and a vanished key reads as `undefined`, which maps to `null`, which means **the
 * venue told us nothing**. That is a different fact from *we stopped being able to ask*, and
 * conflating them would silently undo the `chain_family` distinction this schema was just corrected
 * to make.
 *
 * So every field we claim to read is listed once, per chain family, and its **presence** is asserted
 * at runtime. A key disappearing from the API **throws** rather than becoming a plausible null.
 * AGENTS.md: a payload shape is pinned by a committed fixture plus a runtime assertion, because a
 * shape does not drift gradually — it changes, and a fixture catches it the day it does.
 *
 * The lists below are the single source for both the assertion and the fixture spec, so a field
 * added to the mapper without being pinned fails the build.
 */

export type ChainFamily = 'solana' | 'evm';

/*
 * ## A field absent for ONE TOKEN is not a shape change, and treating it as one loses data
 *
 * My first version required every field below to be present and threw otherwise. The live pass
 * found that wrong within 25 minutes, which is the whole argument for the live pass. Measured
 * 2026-10-12 against the real API:
 *
 * | family | sample | observed absent |
 * |---|---|---|
 * | solana | 12 tokens answered | `metadata_mutable` on **1** |
 * | base   | 8 tokens answered  | none |
 * | eth    | 7 tokens answered  | none |
 * | bsc    | 9 tokens answered  | `is_open_source` on **4** |
 *
 * and the collector's own warnings add `cannot_buy` (5 tokens) and `total_supply` (1) on EVM. So
 * GoPlus simply omits an attribute it has nothing to say about, per token, routinely.
 *
 * Under the strict rule every such token became a FAILED ask: retried five times, then abandoned,
 * with a message blaming the venue for a shape change that never happened. We would have been
 * permanently ignorant about the security of a token BECAUSE the venue answered — the exact
 * failure the fourth state exists to prevent, arriving through the guard instead of the gap.
 *
 * So the invariant moves to the one that is actually about shape:
 *
 * - **NONE of the family's fields present -> THROW.** That is a renamed payload, the wrong chain
 *   family, or an error object wearing a 200, and it must not become a row of nulls.
 * - **SOME absent -> null, meaning "not told"**, which is precisely true and is a state the schema
 *   already distinguishes. Which fields were absent is RECORDED in `absent_fields`, so
 *   "the venue stopped sending buy_tax for everyone" is a query over stored rows rather than a
 *   guess — the audit the throw was standing in for, and one that does not need a release to run.
 */

/** Fields read from a Solana response. */
export const SOLANA_FIELDS = [
  'mintable',
  'freezable',
  'closable',
  'metadata_mutable',
  'balance_mutable_authority',
  'total_supply',
] as const;

/** Fields read from an EVM response. */
export const EVM_FIELDS = [
  'is_open_source',
  'cannot_buy',
  'buy_tax',
  'sell_tax',
  'holder_count',
  'total_supply',
] as const;

export const FIELDS: Record<ChainFamily, readonly string[]> = {
  solana: SOLANA_FIELDS,
  evm: EVM_FIELDS,
};

/**
 * The fields that belong to ONE family only.
 *
 * `total_supply` is in both lists, and that one shared name defeated the first version of the
 * shape check: a Solana token object read as EVM carries `total_supply` and nothing else we read,
 * so "none of the family's fields are present" was false and the mapper happily produced a row of
 * nulls for the wrong chain. A spec caught it, but only because it tried the wrong family on
 * purpose.
 *
 * So the check asks for a DISTINCTIVE field — one that could not have come from the other shape.
 * A token missing `is_open_source` (measured: 4 of 9 on BSC) still carries four others and maps
 * fine; a Solana payload read as EVM carries none and throws.
 */
export const DISTINCTIVE_FIELDS: Record<ChainFamily, readonly string[]> = {
  solana: SOLANA_FIELDS.filter((f) => !(EVM_FIELDS as readonly string[]).includes(f)),
  evm: EVM_FIELDS.filter((f) => !(SOLANA_FIELDS as readonly string[]).includes(f)),
};

export interface TokenSecurityRow {
  chainFamily: ChainFamily;
  mintable: boolean | null;
  freezable: boolean | null;
  closable: boolean | null;
  metadataMutable: boolean | null;
  balanceMutableAuthority: boolean | null;
  isOpenSource: boolean | null;
  cannotBuy: boolean | null;
  buyTax: number | null;
  sellTax: number | null;
  holderCount: number | null;
  totalSupply: number | null;
  /** Fields of this family that the response did not carry for this token. Never null; may be empty. */
  absentFields: string[];
  raw: unknown;
}

/**
 * GoPlus nests its flags: `{"mintable": {"status": "0", "authority": [...]}}` on Solana, and plain
 * `"0"` / `"1"` strings on EVM. Both mean the same thing and neither is a boolean.
 *
 * Returns null for an unparseable or empty value rather than false, because "GoPlus did not say"
 * and "GoPlus said no" are different and a `false` would state the second.
 */
export function flagOrNull(value: unknown): boolean | null {
  const raw = value !== null && typeof value === 'object' && 'status' in (value as object)
    ? (value as { status?: unknown }).status
    : value;
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  if (s === '1') return true;
  if (s === '0') return false;
  return null;
}

/**
 * The token object from a GoPlus response, with every field we read asserted present.
 *
 * Throws on a missing key — deliberately, and it is the point of the file. The alternative is a
 * null that a reader cannot distinguish from a measured absence.
 */
export function absentFields(token: Record<string, unknown>, family: ChainFamily): string[] {
  return FIELDS[family].filter((f) => !(f in token));
}

/**
 * Throws when the token carries NO field distinctive to this family.
 *
 * The threshold is "not one" rather than "not all", because one absent field is a token GoPlus has
 * nothing to say about (measured: routine) while a token with none of the family's own fields
 * cannot be a token of that family at all — it is a renamed payload, the wrong chain family, or an
 * error object wearing a 200. Those must not become a row of nulls indistinguishable from "asked
 * and told nothing".
 */
export function assertShapeRecognisable(token: Record<string, unknown>, family: ChainFamily): void {
  const own = DISTINCTIVE_FIELDS[family];
  if (own.every((f) => !(f in token))) {
    throw new Error(
      `GoPlus ${family} response contains NONE of the ${own.length} fields distinctive to ${family} ` +
      `(${own.join(', ')}); keys present: ${Object.keys(token).slice(0, 8).join(', ') || '<none>'}. ` +
      'This is a shape change or the wrong chain family — it must fail rather than become a row of ' +
      'nulls meaning "asked and told nothing".',
    );
  }
}

export function mapTokenSecurity(body: string, family: ChainFamily): { address: string; row: TokenSecurityRow } | null {
  const payload = JSON.parse(body) as { code?: unknown; result?: Record<string, Record<string, unknown>> };
  const result = payload.result;
  if (result === undefined || Object.keys(result).length === 0) return null;

  const [address, token] = Object.entries(result)[0];
  assertShapeRecognisable(token, family);

  return {
    address,
    row: {
      chainFamily: family,
      // which fields this token had nothing said about. Recorded rather than thrown: see the note
      // above FIELDS. An absence that becomes universal is then visible as data.
      absentFields: absentFields(token, family),
      // solana-only; null on EVM means NOT APPLICABLE, which `chain_family` on the row disambiguates
      mintable: family === 'solana' ? flagOrNull(token['mintable']) : null,
      freezable: family === 'solana' ? flagOrNull(token['freezable']) : null,
      closable: family === 'solana' ? flagOrNull(token['closable']) : null,
      metadataMutable: family === 'solana' ? flagOrNull(token['metadata_mutable']) : null,
      balanceMutableAuthority: family === 'solana' ? flagOrNull(token['balance_mutable_authority']) : null,
      // evm-only
      isOpenSource: family === 'evm' ? flagOrNull(token['is_open_source']) : null,
      cannotBuy: family === 'evm' ? flagOrNull(token['cannot_buy']) : null,
      // `buy_tax` arrives as '' on a fresh token, and Number('') is 0 — a 0 % tax claim GoPlus
      // never made. numberOrNull refuses the empty string for exactly this.
      buyTax: family === 'evm' ? numberOrNull(token['buy_tax']) : null,
      sellTax: family === 'evm' ? numberOrNull(token['sell_tax']) : null,
      holderCount: family === 'evm' ? numberOrNull(token['holder_count']) : null,
      totalSupply: numberOrNull(token['total_supply']),
      raw: token,
    },
  };
}

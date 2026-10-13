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
 * ## Two absences, and a mechanism that cannot tell them apart loses rows
 *
 * The first version of this file required every field below to be PRESENT and threw otherwise. The
 * live pass found that wrong inside the hour, and the reason is the distinction that has settled
 * every other ruling today:
 *
 * - **the API changed shape** — a field we rely on no longer exists -> THROW;
 * - **this token has no answer for this field** — normal, measured, routine -> null, *not told*.
 *
 * One assertion covering both throws on normal data and loses the row, and because a failed ask is
 * retried and then abandoned, the loss is permanent: we end up ignorant about a token's security
 * BECAUSE the venue answered.
 *
 * So each field is classified **per chain family**, and the classification carries its evidence
 * rather than a sentence about it. `always` is the only class that throws, so a wrong `always`
 * costs rows — which is why a field without two occasions of evidence is `optional`, and says so.
 *
 * ### The measurements (live API, 2026-10-12 / 2026-10-13 UTC)
 *
 * | occasion | source | solana answered | evm answered |
 * |---|---|---|---|
 * | A, 00:30–00:50 (three sequential probes) | tokens from GeckoTerminal `new_pools` | 12 | 24 (base 8, eth 7, bsc 9) |
 * | B, 00:56 (one probe) | tokens from `dex_tokens` after a 25-min live run | 8 | 12 (base 7, eth 5, bsc 0 answered) |
 *
 * Two occasions ~20 minutes apart with ≥ 5 answered tokens per family in each, which is what
 * AGENTS.md's repetition rule asks of a claim of this shape. Occasion A is three probes run back to
 * back rather than one, and the token sets differ between A and B — which is the point, since a
 * per-token property measured twice on the same tokens is measured once. Absences seen, by DISTINCT token:
 *
 * - solana `metadata_mutable`: 1 token in A, 1 more in the live run itself -> **optional**
 * - evm `is_open_source`: 4 of 9 BSC tokens in A -> **optional**
 * - evm `total_supply`: 1 token in B (base), 1 in the live run -> **optional**
 * - evm `cannot_buy`: 1 token in the live run (base) -> **optional**
 *
 * **A counting error worth recording**: the live log showed 11 warning lines naming these fields and
 * I first reported them as 11 tokens. They are **3 distinct tokens** — a failed ask is retried up to
 * five times, so the retry inflated the count fivefold. A rate of absence measured from a log that
 * retries is a rate of retries.
 *
 * BSC answered 0 of 8 in occasion B against 9 of 10 in A, so GoPlus's "no result at all" rate is
 * highly variable per network. That is a note, not a number: it has one occasion per direction.
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
 * `always` means every answered token carried it across both occasions above, so its absence is a
 * shape change and MUST throw. `optional` means at least one token legitimately lacked it, so its
 * absence is "not told" and becomes null.
 *
 * A field with fewer than two occasions of evidence is `optional` whatever it looked like, because
 * the two errors are not symmetric: a wrong `optional` silently nulls a field we could have read
 * and is visible in `absent_fields`, while a wrong `always` throws on normal data and loses the
 * row for good.
 */
export type Presence = 'always' | 'optional';

export interface FieldContract {
  field: string;
  presence: Presence;
  /** What was observed, with counts and populations. The claim carries this, not a sentence. */
  evidence: string;
}

const PRESENT_IN_BOTH = 'present in all answered tokens, occasions A (n=12 solana / 24 evm) and B (n=8 / 12)';

export const FIELD_CONTRACTS: Record<ChainFamily, readonly FieldContract[]> = {
  solana: [
    { field: 'mintable', presence: 'always', evidence: PRESENT_IN_BOTH },
    { field: 'freezable', presence: 'always', evidence: PRESENT_IN_BOTH },
    { field: 'closable', presence: 'always', evidence: PRESENT_IN_BOTH },
    {
      field: 'metadata_mutable',
      presence: 'optional',
      evidence: 'absent on 1 of 12 tokens in occasion A, and on 1 more distinct token during the 25-minute live run',
    },
    { field: 'balance_mutable_authority', presence: 'always', evidence: PRESENT_IN_BOTH },
    { field: 'total_supply', presence: 'always', evidence: PRESENT_IN_BOTH },
  ],
  evm: [
    {
      field: 'is_open_source',
      presence: 'optional',
      evidence: 'absent on 4 of 9 answered BSC tokens in occasion A; present on all base and eth tokens in both',
    },
    {
      field: 'cannot_buy',
      presence: 'optional',
      evidence: 'absent on 1 distinct base token during the live run (the log\'s 5 lines are 5 retries of it)',
    },
    { field: 'buy_tax', presence: 'always', evidence: PRESENT_IN_BOTH },
    { field: 'sell_tax', presence: 'always', evidence: PRESENT_IN_BOTH },
    { field: 'holder_count', presence: 'always', evidence: PRESENT_IN_BOTH },
    {
      field: 'total_supply',
      presence: 'optional',
      evidence: 'absent on 1 of 7 answered base tokens in occasion B, and on 1 distinct token during the live run',
    },
  ],
};

/** The fields whose absence is a shape change rather than an unanswered question. */
export const ALWAYS_PRESENT: Record<ChainFamily, readonly string[]> = {
  solana: FIELD_CONTRACTS.solana.filter((c) => c.presence === 'always').map((c) => c.field),
  evm: FIELD_CONTRACTS.evm.filter((c) => c.presence === 'always').map((c) => c.field),
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
 * Throws when a field classified `always` is missing.
 *
 * That is the shape-change case and only that case: an `optional` field's absence is a question
 * the venue did not answer and is recorded, not raised. The message names the evidence, because
 * the next person to see this throw needs to know whether the API changed or whether my
 * classification was too strong — and the second is a real possibility I cannot rule out from two
 * occasions.
 *
 * It also covers the WRONG CHAIN FAMILY without a separate check: no Solana payload carries
 * `buy_tax`, `sell_tax` and `holder_count`, and no EVM payload carries `mintable`. The one shared
 * name, `total_supply`, cannot carry a family on its own.
 */
export function assertShapeRecognisable(token: Record<string, unknown>, family: ChainFamily): void {
  const missing = ALWAYS_PRESENT[family].filter((f) => !(f in token));
  if (missing.length > 0) {
    const contracts = FIELD_CONTRACTS[family].filter((c) => missing.includes(c.field));
    throw new Error(
      `GoPlus ${family} response is missing field(s) measured as ALWAYS present: ${missing.join(', ')}. ` +
      `Evidence for that classification: ${contracts.map((c) => `${c.field} — ${c.evidence}`).join('; ')}. ` +
      `Keys present: ${Object.keys(token).slice(0, 8).join(', ') || '<none>'}. ` +
      'Either the API changed shape, or this is the wrong chain family, or the field is in fact ' +
      'optional and the classification needs re-measuring — it must not become a null meaning ' +
      '"asked and told nothing".',
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

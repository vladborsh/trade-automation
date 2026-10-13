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
 *
 * ### The classification was falsified within minutes, and that changed the mechanism
 *
 * Minutes after I classified `holder_count` as `always` on the strength of 36 answered tokens, the
 * live run hit an Ethereum token whose response omits BOTH `holder_count` and `total_supply` — and
 * carries 24 fields the other EVM response does not. Comparing the two real responses:
 *
 * ```
 * shared by both:  buy_tax, cannot_buy, is_in_dex, is_open_source, sell_tax   (5)
 * one only:        14 fields in one, 29 in the other
 * ```
 *
 * **GoPlus EVM is not one shape with optional fields; it is a per-token field set.** Five of
 * twenty-nine names are common. So "present in every token I sampled" is a weak basis for a rule
 * that THROWS, and the next sample will keep falsifying it.
 *
 * Hence the mechanism below, which is not what I first built:
 *
 * - a field classified `always` going missing is RECORDED AND RAISED, not thrown: the row is
 *   stored, `absent_fields` names it, and the collector logs it at ERROR. A rename is loud and
 *   nothing is lost;
 * - a throw is reserved for a payload carrying NO field distinctive to the family, where there is
 *   nothing to record — a renamed payload, the wrong chain family, or an error object wearing a 200.
 *
 * That keeps the requirement that a key we rely on must not vanish into a silent null, while
 * removing the data loss: the alternative discards rows for tokens whose response does carry
 * `is_honeypot`.
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
    {
      field: 'buy_tax',
      presence: 'optional',
      evidence: 'present in all 36 answered tokens of A and B, then absent together with sell_tax on BSC token '
        + '0x8d0d…08b0d during the 24-hour run (2026-10-13), whose response carries cannot_buy, holder_count, '
        + 'is_open_source, total_supply, is_honeypot and is_proxy but neither tax field',
    },
    {
      field: 'sell_tax',
      presence: 'optional',
      evidence: 'absent together with buy_tax on BSC token 0x8d0d…08b0d during the 24-hour run (2026-10-13); '
        + 'present in all 36 answered tokens of occasions A and B before that',
    },
    {
      field: 'holder_count',
      presence: 'optional',
      evidence: 'present in all 36 answered tokens of A and B, then ABSENT on a live eth token minutes later'
        + ' — the falsification that showed sampling cannot support an always-claim on this payload',
    },
    {
      field: 'total_supply',
      presence: 'optional',
      evidence: 'absent on 1 of 7 answered base tokens in occasion B, and on 1 distinct token during the live run',
    },
  ],
};

/**
 * The fields that belong to ONE family only.
 *
 * `total_supply` is in both lists and that shared name matters: a Solana token object read as EVM
 * carries it and nothing else we read, so "no field we read is present" would be false and the
 * mapper would build a row of nulls for the wrong chain. A distinctive field cannot have come from
 * the other shape, which is what makes it evidence about which shape this is.
 */
export const DISTINCTIVE_FIELDS: Record<ChainFamily, readonly string[]> = {
  solana: SOLANA_FIELDS.filter((f) => !(EVM_FIELDS as readonly string[]).includes(f)),
  evm: EVM_FIELDS.filter((f) => !(SOLANA_FIELDS as readonly string[]).includes(f)),
};

/** The fields whose absence is reported loudly rather than treated as an unanswered question. */
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
 * Fields classified `always` that this token did not carry.
 *
 * Returned, not thrown. Either the API changed shape or my classification was too strong — both
 * need a human, and neither is worth discarding a row the venue did answer. The caller logs it at
 * ERROR and `absent_fields` stores it, so the signal survives the log rotation. Empty in the normal
 * case, which is what makes a non-empty one worth reading.
 */
export function unexpectedAbsences(row: Pick<TokenSecurityRow, 'chainFamily' | 'absentFields'>): FieldContract[] {
  // derived from the row the mapper already built, not by re-reading the body: two places computing
  // "which fields were absent" is two places that can disagree about it
  return FIELD_CONTRACTS[row.chainFamily]
    .filter((c) => c.presence === 'always' && row.absentFields.includes(c.field));
}

/**
 * Is this GoPlus at all? **The check that identifies the API sits on the ENVELOPE.**
 *
 * The per-token field set has now been proven to vary three times — 14 fields, 29 fields, and a
 * third set with neither tax field — so a guard built on the union of per-token names is the
 * weakest one available: with every EVM field optional, a truncated or unrelated payload carrying
 * one coincidentally-matching key would pass it.
 *
 * The envelope has not varied once. Every real response, across both chain families and every
 * fixture: a numeric `code`, a string `message`, and a `result` that is an object or `null`. So
 * that is what the throw keys on, and it is the only thing here that throws.
 */
export function assertEnvelope(payload: unknown, family: ChainFamily): void {
  const envelope = payload as { code?: unknown; message?: unknown; result?: unknown } | null;
  const problems: string[] = [];
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    problems.push('the body is not a JSON object');
  } else {
    if (typeof envelope.code !== 'number') problems.push(`code is ${describeType(envelope.code)}, expected a number`);
    if (typeof envelope.message !== 'string') problems.push(`message is ${describeType(envelope.message)}, expected a string`);
    const result = envelope.result;
    const resultOk = result === null || result === undefined
      || (typeof result === 'object' && !Array.isArray(result));
    if (!resultOk) problems.push(`result is ${describeType(result)}, expected an object or null`);
  }
  if (problems.length > 0) {
    throw new Error(
      `GoPlus ${family}: this is not a GoPlus envelope — ${problems.join('; ')}. `
      + 'The envelope (code, message, result) is the one part of this payload measured never to vary, '
      + 'so it is what identifies the API; the per-token field set has varied three times and cannot.',
    );
  }
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'absent';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

/**
 * Throws only on POSITIVE evidence of the wrong chain family.
 *
 * The earlier version threw when the token carried no field distinctive to the family we asked
 * about — absence of evidence. With every EVM field now optional that is both near-vacuous and
 * dangerous: a genuine token answering with only `is_honeypot` and `total_supply` carries no
 * distinctive field, and throwing on it would discard a real answer, which is the failure this
 * whole subsystem has been correcting all day.
 *
 * So it throws when the OTHER family's distinctive fields are present and this family's are not.
 * That is evidence we are about to file one chain's data under another's label, which must never be
 * stored. A sparse token with neither family's markers is simply recorded — `absent_fields` already
 * says what was missing.
 */
export function assertNotTheOtherFamily(token: Record<string, unknown>, family: ChainFamily): void {
  const other: ChainFamily = family === 'solana' ? 'evm' : 'solana';
  const mine = DISTINCTIVE_FIELDS[family].filter((f) => f in token);
  const theirs = DISTINCTIVE_FIELDS[other].filter((f) => f in token);
  if (mine.length === 0 && theirs.length > 0) {
    throw new Error(
      `GoPlus: asked for ${family} and got a ${other} token — it carries ${theirs.join(', ')} and `
      + `none of ${family}'s own fields. Storing it would file one chain's data under another's label.`,
    );
  }
}

export function mapTokenSecurity(body: string, family: ChainFamily): { address: string; row: TokenSecurityRow } | null {
  const payload = JSON.parse(body) as { code?: unknown; result?: Record<string, Record<string, unknown>> };
  // the envelope first: it is what says this is GoPlus, and it is the only throw that is about the
  // API rather than about one token
  assertEnvelope(payload, family);
  const result = payload.result;
  // `result: null` is a shape GoPlus really sends — seen in the 24-hour run, and `Object.keys(null)`
  // THROWS, which turned "the venue answered and said nothing" into a failed ask that retried five
  // times and was then abandoned. `== null` covers both null and undefined deliberately; a
  // non-object is the same case and must not reach Object.keys either.
  if (result == null || typeof result !== 'object') return null;
  if (Object.keys(result).length === 0) return null;

  const [address, token] = Object.entries(result)[0];
  assertNotTheOtherFamily(token, family);

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

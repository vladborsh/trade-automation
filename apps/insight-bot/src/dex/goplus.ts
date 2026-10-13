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

/** Fields read from a Solana response. Every one must be PRESENT or the mapping throws. */
export const SOLANA_FIELDS = [
  'mintable',
  'freezable',
  'closable',
  'metadata_mutable',
  'balance_mutable_authority',
  'total_supply',
] as const;

/** Fields read from an EVM response. Every one must be PRESENT or the mapping throws. */
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
export function assertFieldsPresent(token: Record<string, unknown>, family: ChainFamily): void {
  const missing = FIELDS[family].filter((f) => !(f in token));
  if (missing.length > 0) {
    throw new Error(
      `GoPlus ${family} response is missing field(s) we read: ${missing.join(', ')}. ` +
      'The API shape changed — this must fail rather than become a null meaning "not told".',
    );
  }
}

export function mapTokenSecurity(body: string, family: ChainFamily): { address: string; row: TokenSecurityRow } | null {
  const payload = JSON.parse(body) as { code?: unknown; result?: Record<string, Record<string, unknown>> };
  const result = payload.result;
  if (result === undefined || Object.keys(result).length === 0) return null;

  const [address, token] = Object.entries(result)[0];
  assertFieldsPresent(token, family);

  return {
    address,
    row: {
      chainFamily: family,
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

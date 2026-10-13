import type { Network } from './mappers';

/**
 * IB-028 — the ONE canonical stored form of an address, per chain.
 *
 * The join at ingest was fixed by folding case on EVM (see `dexscreener.ts`). That left the stored
 * form open, and the hole is worse than the join was: `dex_tokens` carries
 * `unique (network, address)`, and **a unique index cannot see case-equivalence**, so two spellings
 * of one EVM address satisfy it and give two rows for one token. Today nothing breaks because every
 * address arrives from GeckoTerminal, which lower-cases; it breaks silently the first time one
 * arrives from DexScreener (EIP-55 checksummed), from GoPlus's echo, or from a hand-typed query —
 * and then every join downstream has the bug, in a place nobody is looking.
 *
 * So the rule is enforced in three places that cannot drift apart:
 *
 * 1. here, where values are produced;
 * 2. in the schema, as `check (network = 'solana' or address = lower(address))`, so a non-canonical
 *    EVM address **cannot be stored** and the unique index starts meaning what it claims;
 * 3. in a spec that attempts the forbidden insert and watches the database refuse it.
 *
 * **Lossless on EVM, and that is the whole reason this is available.** Hex case carries no
 * information — EIP-55 checksumming is a typo detector layered on top of a case-insensitive
 * string — so lower-casing throws nothing away and the original spelling is kept in `raw` anyway.
 * Solana's base58 is case-SENSITIVE: `A` and `a` are different digits of different addresses, so
 * there is no canonical form to move to and folding would be a correctness bug. That asymmetry is
 * why this is a per-chain function rather than one `toLowerCase()`, and why the check constraint
 * exempts Solana rather than applying to every row.
 */
export function canonicalAddress(network: Network, address: string): string {
  return network === 'solana' ? address : address.toLowerCase();
}

/**
 * The same rule for GeckoTerminal's `<network>_<address>` ids.
 *
 * The ids are the join keys — `dex_pools.pool_id`, `dex_tokens.token_id`,
 * `dex_token_security.token_id` — so leaving them in the venue's spelling while canonicalising the
 * address column would put the inconsistency back in the column that actually joins. The network
 * prefix is already lower-case, so this is the address rule applied to the whole string.
 */
export function canonicalId(network: Network, id: string): string {
  return network === 'solana' ? id : id.toLowerCase();
}

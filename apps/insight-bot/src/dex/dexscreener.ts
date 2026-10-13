import { canonicalAddress } from './address';
import { numberOrNull, type Network } from './mappers';

/**
 * IB-028 — DexScreener's batched pair response into rows (§10). Pure: bytes in, rows out.
 *
 * ## The join is by ADDRESS and it is case-sensitive only on Solana
 *
 * We ask for 20 pool addresses taken from GeckoTerminal and get back a `pairs` array that is
 * neither ordered nor complete, so rows must be matched by address. Measured 2026-10-12 against
 * the live API on two occasions ~20 minutes apart:
 *
 * | network | requested | returned | matched exactly | matched case-insensitively |
 * |---|---|---|---|---|
 * | solana | 20 | 19, then 20 | 19, then 20 | same |
 * | base   | 20 | 20, then 20 | **17, then 18** | 20, then 20 |
 *
 * **On Base, two to three of twenty addresses came back in different letter case** — DexScreener
 * returns EVM addresses checksummed (EIP-55) while GeckoTerminal returns them lower-cased. An
 * exact-string join would therefore have silently dropped ~15 % of EVM pairs, and the loss would
 * have looked exactly like "DexScreener does not know these pools".
 *
 * So the key is lower-cased for EVM networks, where hex case carries no meaning, and left verbatim
 * for Solana, where base58 **is** case-sensitive and `A` and `a` are different addresses. Folding
 * case on Solana would be a correctness bug rather than a convenience, which is why this is a
 * per-chain decision and not one `toLowerCase()`.
 *
 * ## A pool DexScreener does not know gets NO ROW
 *
 * 19 pairs for 20 addresses is routine, and the missing one is not a pair with zero liquidity —
 * nothing was said about it at all. Returning a null-filled row would put a measurement we never
 * made into the history; returning no row makes the absence visible as a gap against `dex_pools`.
 */

export interface DexPairRow {
  poolId: string;
  network: Network;
  address: string;
  observedAt: Date;
  dex: string | null;
  pairCreatedAt: Date | null;
  priceUsd: number | null;
  priceNative: number | null;
  liquidityUsd: number | null;
  fdvUsd: number | null;
  marketCapUsd: number | null;
  volumeUsdM5: number | null;
  volumeUsdH1: number | null;
  volumeUsdH6: number | null;
  volumeUsdH24: number | null;
  txnsH1Buys: number | null;
  txnsH1Sells: number | null;
  txnsH24Buys: number | null;
  txnsH24Sells: number | null;
  priceChangePctH1: number | null;
  priceChangePctH24: number | null;
  raw: unknown;
}

export interface PairMapResult {
  rows: DexPairRow[];
  /** Addresses we asked about and were told nothing about. Reported, never written as zeros. */
  missing: string[];
  skipped: Array<{ reason: string; sample: string }>;
}

/**
 * The lookup key, which is also the canonical stored form — deliberately the same function, so the
 * key a row is found by and the string it is stored as cannot drift apart. See `address.ts`.
 */
export const addressKey = canonicalAddress;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A nested reading such as `volume.h1`; absent nesting is absent, not zero. */
function nested(pair: Record<string, unknown>, group: string, key: string): number | null {
  const g = asRecord(pair[group]);
  return g === null ? null : numberOrNull(g[key]);
}

function intOrNull(value: unknown): number | null {
  const n = numberOrNull(value);
  return n === null ? null : Math.trunc(n);
}

/**
 * The pairs for the addresses we asked about.
 *
 * `requested` is required rather than optional: without it there is no way to report what was
 * missing, and "DexScreener returned fewer pairs than we asked for" is the fact most likely to be
 * mistaken for an empty market.
 */
export function mapPairs(
  body: string,
  network: Network,
  requested: readonly string[],
  observedAt: Date,
): PairMapResult {
  const skipped: Array<{ reason: string; sample: string }> = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    throw new Error(`dexscreener ${network}: unparseable body — ${(error as Error).message}`);
  }
  const envelope = asRecord(parsed);
  if (envelope === null) throw new Error(`dexscreener ${network}: body is not an object`);

  // `pairs` is null — not absent, and not an empty array — when nothing matched. Measured: the
  // sibling `pair` field is always null on this endpoint, so it is deliberately not read.
  const pairs = Array.isArray(envelope.pairs) ? envelope.pairs : [];

  const byKey = new Map<string, Record<string, unknown>>();
  for (const entry of pairs) {
    const pair = asRecord(entry);
    const address = pair === null ? null : pair.pairAddress;
    if (typeof address !== 'string' || address.length === 0) {
      skipped.push({ reason: 'pair without a pairAddress', sample: JSON.stringify(entry).slice(0, 120) });
      continue;
    }
    const key = addressKey(network, address);
    if (byKey.has(key)) {
      // two pairs folding to one key would mean the fold is wrong for this chain, not that the
      // venue duplicated a pool. Loud, because a silent fold mis-joins readings between pools.
      throw new Error(`dexscreener ${network}: two pairs share the key ${key} — the address fold is wrong for this chain`);
    }
    byKey.set(key, pair as Record<string, unknown>);
  }

  const rows: DexPairRow[] = [];
  const missing: string[] = [];
  for (const asked of requested) {
    const pair = byKey.get(addressKey(network, asked));
    if (pair === undefined) {
      missing.push(asked);
      continue;
    }
    // DexScreener's own spelling goes to `raw`; the column gets the canonical form, or the unique
    // and join guarantees downstream would rest on which venue happened to write the row first
    const address = canonicalAddress(network, pair.pairAddress as string);
    const createdMs = numberOrNull(pair.pairCreatedAt);
    const liquidity = asRecord(pair.liquidity);
    rows.push({
      // built from the address we ASKED about, so this row joins to the dex_pools row it describes
      // even when DexScreener spells the address with different capitalisation
      poolId: `${network}_${canonicalAddress(network, asked)}`,
      network,
      address,
      observedAt,
      dex: typeof pair.dexId === 'string' ? pair.dexId : null,
      pairCreatedAt: createdMs === null ? null : new Date(createdMs),
      priceUsd: numberOrNull(pair.priceUsd),
      priceNative: numberOrNull(pair.priceNative),
      // absent on most new Solana pairs — see the file comment; null, never 0
      liquidityUsd: liquidity === null ? null : numberOrNull(liquidity.usd),
      fdvUsd: numberOrNull(pair.fdv),
      marketCapUsd: numberOrNull(pair.marketCap),
      volumeUsdM5: nested(pair, 'volume', 'm5'),
      volumeUsdH1: nested(pair, 'volume', 'h1'),
      volumeUsdH6: nested(pair, 'volume', 'h6'),
      volumeUsdH24: nested(pair, 'volume', 'h24'),
      txnsH1Buys: intOrNull(asRecord(asRecord(pair.txns)?.h1)?.buys),
      txnsH1Sells: intOrNull(asRecord(asRecord(pair.txns)?.h1)?.sells),
      txnsH24Buys: intOrNull(asRecord(asRecord(pair.txns)?.h24)?.buys),
      txnsH24Sells: intOrNull(asRecord(asRecord(pair.txns)?.h24)?.sells),
      priceChangePctH1: nested(pair, 'priceChange', 'h1'),
      priceChangePctH24: nested(pair, 'priceChange', 'h24'),
      raw: pair,
    });
  }
  return { rows, missing, skipped };
}

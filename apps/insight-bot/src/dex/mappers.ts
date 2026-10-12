/**
 * IB-028 — GeckoTerminal's pool JSON into rows (§10, §13 p.4). Pure: bytes in, rows out, so every
 * rule below is spec'd against a recorded fixture rather than a live endpoint that changes under
 * the test.
 *
 * ## Absent is not zero, and here it is the NORM
 *
 * All 20 pools in the recorded `new_pools` page carry `market_cap_usd: null` — GeckoTerminal does
 * not know the cap of a token minted minutes ago. So the unknown case is not an edge here, it is
 * the common one, and a mapper that coalesced to 0 would report twenty tokens with a market cap of
 * zero dollars. Every reading is therefore `number | null`, `null` means *not told*, and a genuine
 * 0 — a pool with no trades in the window — stays 0 and is distinguishable because of it.
 *
 * `numberOrNull` refuses `''`, `undefined` and `NaN` as well as `null`: the API sends numbers as
 * strings, and `Number('')` is 0, which is exactly the silent conversion this file exists to stop.
 */

export type Network = 'solana' | 'base' | 'bsc' | 'eth';
export type Listing = 'new_pools' | 'trending_pools';

export interface DexPoolRow {
  poolId: string;
  network: Network;
  address: string;
  dex: string | null;
  name: string | null;
  baseTokenId: string | null;
  quoteTokenId: string | null;
  poolCreatedAt: Date | null;
  listing: Listing;
  observedAt: Date;
  basePriceUsd: number | null;
  fdvUsd: number | null;
  marketCapUsd: number | null;
  reserveUsd: number | null;
  volumeUsdH24: number | null;
  priceChangePctH24: number | null;
  txnsH24Buys: number | null;
  txnsH24Sells: number | null;
}

export interface MapResult {
  rows: DexPoolRow[];
  /** Entries refused, with why — a shape change must be visible, not a quietly shorter list. */
  skipped: Array<{ reason: string; sample: string }>;
}

/**
 * A number, or null when we were not told one.
 *
 * `Number('')` is 0 and `Number(null)` is 0, so the guards are on the INPUT rather than on the
 * result: by the time it is a number the distinction is gone.
 */
export function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim().length === 0) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length === 0 ? null : t;
}

function dateOrNull(value: unknown): Date | null {
  const s = stringOrNull(value);
  if (s === null) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

interface RawPool {
  id?: unknown;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: { id?: unknown } }>;
}

/** `solana_6keVw8...` → the address part. The id is kept whole as the join key back to the API. */
function addressFromId(poolId: string, network: string): string | null {
  const prefix = `${network}_`;
  return poolId.startsWith(prefix) ? poolId.slice(prefix.length) : null;
}

export function mapPools(
  body: string,
  network: Network,
  listing: Listing,
  observedAt: Date,
): MapResult {
  const skipped: MapResult['skipped'] = [];
  let payload: { data?: unknown };
  try {
    payload = JSON.parse(body) as typeof payload;
  } catch (error) {
    return { rows: [], skipped: [{ reason: `unparseable json: ${(error as Error).message}`, sample: body.slice(0, 80) }] };
  }

  const data = Array.isArray(payload.data) ? (payload.data as RawPool[]) : null;
  if (data === null) {
    return { rows: [], skipped: [{ reason: 'payload.data is not an array', sample: JSON.stringify(payload).slice(0, 80) }] };
  }

  const rows: DexPoolRow[] = [];
  for (const pool of data) {
    const poolId = stringOrNull(pool.id);
    if (poolId === null) {
      skipped.push({ reason: 'pool without an id', sample: JSON.stringify(pool).slice(0, 80) });
      continue;
    }
    const address = addressFromId(poolId, network);
    if (address === null) {
      // the id's `<network>_` prefix is a shape assumption; if it ever stops holding we must see it
      skipped.push({ reason: `id does not start with '${network}_'`, sample: poolId });
      continue;
    }

    const a = pool.attributes ?? {};
    const rel = pool.relationships ?? {};
    const volume = a['volume_usd'] as Record<string, unknown> | undefined;
    const change = a['price_change_percentage'] as Record<string, unknown> | undefined;
    const txns = a['transactions'] as Record<string, Record<string, unknown>> | undefined;

    rows.push({
      poolId,
      network,
      address,
      dex: stringOrNull(rel['dex']?.data?.id),
      name: stringOrNull(a['name']),
      baseTokenId: stringOrNull(rel['base_token']?.data?.id),
      quoteTokenId: stringOrNull(rel['quote_token']?.data?.id),
      poolCreatedAt: dateOrNull(a['pool_created_at']),
      listing,
      observedAt,
      basePriceUsd: numberOrNull(a['base_token_price_usd']),
      fdvUsd: numberOrNull(a['fdv_usd']),
      marketCapUsd: numberOrNull(a['market_cap_usd']),
      reserveUsd: numberOrNull(a['reserve_in_usd']),
      volumeUsdH24: numberOrNull(volume?.['h24']),
      priceChangePctH24: numberOrNull(change?.['h24']),
      txnsH24Buys: numberOrNull(txns?.['h24']?.['buys']),
      txnsH24Sells: numberOrNull(txns?.['h24']?.['sells']),
    });
  }

  return { rows, skipped };
}

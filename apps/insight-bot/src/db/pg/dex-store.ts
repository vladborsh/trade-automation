import type { Db } from '../db.port';
import type { DexPoolRow } from '../../dex/mappers';
import type { TokenSecurityRow } from '../../dex/goplus';

/**
 * IB-028 — the DEX snapshot writes. SQL lives in `src/db/pg/` (IB-004).
 *
 * Collection only: everything here appends. Nothing is filtered, scored or dropped, because the
 * table's whole value is a history of candidates INCLUDING the ones a later filter would discard.
 */

/** One row per pool per listing per poll. Append-only; a repeat poll is a new observation. */
export async function writePools(db: Db, rows: readonly DexPoolRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  let written = 0;
  for (const r of rows) {
    const inserted = await db.query<{ pool_id: string }>(
      `insert into dex_pools (
         pool_id, network, address, dex, name, base_token_id, quote_token_id, pool_created_at,
         listing, observed_at, base_price_usd, fdv_usd, market_cap_usd, reserve_usd,
         volume_usd_h24, price_change_pct_h24, txns_h24_buys, txns_h24_sells)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       on conflict (pool_id, listing, observed_at) do nothing
       returning pool_id`,
      [
        r.poolId, r.network, r.address, r.dex, r.name, r.baseTokenId, r.quoteTokenId, r.poolCreatedAt,
        r.listing, r.observedAt, r.basePriceUsd, r.fdvUsd, r.marketCapUsd, r.reserveUsd,
        r.volumeUsdH24, r.priceChangePctH24, r.txnsH24Buys, r.txnsH24Sells,
      ],
    );
    if (inserted.length > 0) written += 1;
  }
  return written;
}

/**
 * Records a token the first time it is seen, and returns whether this call was that first sight.
 *
 * `first_seen_at` is OURS and never the venue's: it is the instant from which we are responsible
 * for the token, and the chain's creation time is a claim about the chain. The return value is what
 * drives the §10 security schedule — only a genuinely new token needs a first-sight check.
 */
export async function noteToken(
  db: Db,
  token: { tokenId: string; network: string; address: string; symbol: string | null; name: string | null },
  at: Date,
): Promise<boolean> {
  const rows = await db.query<{ token_id: string }>(
    `insert into dex_tokens (token_id, network, address, symbol, name, first_seen_at)
          values ($1,$2,$3,$4,$5,$6)
     on conflict (token_id) do nothing
       returning token_id`,
    [token.tokenId, token.network, token.address, token.symbol, token.name, at],
  );
  return rows.length > 0;
}

/** The security snapshot for one stage. Re-running a stage replaces it rather than duplicating. */
export async function writeTokenSecurity(
  db: Db,
  tokenId: string,
  stage: 'first_seen' | 'h6' | 'h24',
  checkedAt: Date,
  row: TokenSecurityRow,
): Promise<void> {
  await db.query(
    `insert into dex_token_security (
       token_id, at_stage, checked_at, chain_family, mintable, freezable, closable,
       metadata_mutable, balance_mutable_authority, is_open_source, cannot_buy,
       buy_tax, sell_tax, holder_count, total_supply, raw)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     on conflict (token_id, at_stage) do update set
       checked_at = excluded.checked_at, raw = excluded.raw,
       mintable = excluded.mintable, freezable = excluded.freezable, closable = excluded.closable,
       metadata_mutable = excluded.metadata_mutable,
       balance_mutable_authority = excluded.balance_mutable_authority,
       is_open_source = excluded.is_open_source, cannot_buy = excluded.cannot_buy,
       buy_tax = excluded.buy_tax, sell_tax = excluded.sell_tax,
       holder_count = excluded.holder_count, total_supply = excluded.total_supply`,
    [
      tokenId, stage, checkedAt, row.chainFamily, row.mintable, row.freezable, row.closable,
      row.metadataMutable, row.balanceMutableAuthority, row.isOpenSource, row.cannotBuy,
      row.buyTax, row.sellTax, row.holderCount, row.totalSupply, JSON.stringify(row.raw),
    ],
  );
}

/**
 * Tokens due a security check at a stage: first seen longer ago than the stage's offset, and not
 * yet checked at it.
 *
 * "Not yet asked" is the ABSENCE of a row, which is why this is a NOT EXISTS rather than a null
 * test — the schema comment says the same thing and the two must agree.
 */
export async function tokensDueSecurity(
  db: Db,
  stage: 'h6' | 'h24',
  now: Date,
  limit = 50,
): Promise<Array<{ tokenId: string; network: string; address: string }>> {
  const offsetMs = stage === 'h6' ? 6 * 3_600_000 : 24 * 3_600_000;
  const rows = await db.query<{ token_id: string; network: string; address: string }>(
    `select t.token_id, t.network, t.address
       from dex_tokens t
      where t.first_seen_at <= $1
        and not exists (
          select 1 from dex_token_security s
           where s.token_id = t.token_id and s.at_stage = $2)
      order by t.first_seen_at
      limit $3`,
    [new Date(now.getTime() - offsetMs), stage, limit],
  );
  return rows.map((r) => ({ tokenId: r.token_id, network: r.network, address: r.address }));
}

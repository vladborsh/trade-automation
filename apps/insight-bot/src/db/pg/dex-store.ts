import type { Db } from '../db.port';
import type { DexPairRow } from '../../dex/dexscreener';
import type { DexPoolRow } from '../../dex/mappers';
import type { TokenSecurityRow } from '../../dex/goplus';
import { SECURITY_STAGE_OFFSETS_MS, type SecurityStage } from '../../dex/schedule';

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
 * DexScreener's reading of the same pools. Append-only, like `writePools`, and for the same reason.
 *
 * A pool DexScreener did not answer about is simply not in `rows` — the mapper reports it as
 * missing and nothing is written, because a row of nulls here would be a measurement never made.
 */
export async function writePairSnapshots(db: Db, rows: readonly DexPairRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  let written = 0;
  for (const r of rows) {
    const inserted = await db.query<{ pool_id: string }>(
      `insert into dex_pair_snapshots (
         pool_id, network, address, observed_at, dex, pair_created_at,
         price_usd, price_native, liquidity_usd, fdv_usd, market_cap_usd,
         volume_usd_m5, volume_usd_h1, volume_usd_h6, volume_usd_h24,
         txns_h1_buys, txns_h1_sells, txns_h24_buys, txns_h24_sells,
         price_change_pct_h1, price_change_pct_h24, raw)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       on conflict (pool_id, observed_at) do nothing
       returning pool_id`,
      [
        r.poolId, r.network, r.address, r.observedAt, r.dex, r.pairCreatedAt,
        r.priceUsd, r.priceNative, r.liquidityUsd, r.fdvUsd, r.marketCapUsd,
        r.volumeUsdM5, r.volumeUsdH1, r.volumeUsdH6, r.volumeUsdH24,
        r.txnsH1Buys, r.txnsH1Sells, r.txnsH24Buys, r.txnsH24Sells,
        r.priceChangePctH1, r.priceChangePctH24, JSON.stringify(r.raw),
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

/**
 * How many failed attempts before a stage is abandoned.
 *
 * A failure must be retried (it may be a timeout) but not for ever (it may be a token GoPlus will
 * never answer about). Giving up is recorded in the row — `answered = false` with a reason and the
 * attempt count — so "we stopped asking" is visible rather than being an absence somebody has to
 * infer.
 */
export const MAX_SECURITY_ATTEMPTS = 5;

/** The security snapshot for one stage. Re-running a stage replaces it rather than duplicating. */
export async function writeTokenSecurity(
  db: Db,
  tokenId: string,
  stage: SecurityStage,
  checkedAt: Date,
  row: TokenSecurityRow,
): Promise<void> {
  await db.query(
    `insert into dex_token_security (
       token_id, at_stage, checked_at, chain_family, mintable, freezable, closable,
       metadata_mutable, balance_mutable_authority, is_open_source, cannot_buy,
       buy_tax, sell_tax, holder_count, total_supply, raw, absent_fields, answered, failure_reason, attempts)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,true,null,1)
     on conflict (token_id, at_stage) do update set
       checked_at = excluded.checked_at, raw = excluded.raw,
       -- an answer clears the failure but NOT the attempt count: answered alone stops the asking,
       -- so zeroing it would erase how many calls this stage cost without changing any behaviour
       answered = true, failure_reason = null, absent_fields = excluded.absent_fields,
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
      row.absentFields,
    ],
  );
}

/**
 * Records that an ask FAILED: an attempt, not an answer.
 *
 * The row makes the failure visible and the attempt count makes repeated failure bounded, while
 * `answered = false` keeps the token due — which is the whole distinction. A failure written as an
 * answer with null flags would look exactly like "the venue told us nothing" and the token would
 * never be asked again.
 */
export async function writeSecurityFailure(
  db: Db,
  tokenId: string,
  stage: SecurityStage,
  at: Date,
  chainFamily: 'solana' | 'evm',
  reason: string,
): Promise<void> {
  await db.query(
    `insert into dex_token_security (token_id, at_stage, checked_at, chain_family, raw, answered, failure_reason, attempts)
          values ($1,$2,$3,$4,'{}'::jsonb,false,$5,1)
     on conflict (token_id, at_stage) do update set
       checked_at = excluded.checked_at,
       failure_reason = excluded.failure_reason,
       -- only a FAILED row accumulates attempts; an answered row that later fails starts again,
       -- which is correct: the previous success is evidence the token can be answered about
       attempts = case when dex_token_security.answered then 1 else dex_token_security.attempts + 1 end,
       answered = false`,
    [tokenId, stage, at, chainFamily, reason],
  );
}

/**
 * Tokens due a security check at a stage.
 *
 * **Keyed on `answered`, never on a row existing.** A row may be a recorded FAILURE, which must
 * leave the token due; only an answer — including one where the venue told us nothing — stops the
 * asking. Abandoned after `MAX_SECURITY_ATTEMPTS` so a token that can never be answered does not
 * consume the rate budget for ever.
 *
 * Suppression is per STAGE: `at_stage` is in the predicate, so answering at first sight does not
 * silently cancel the +6 h and +24 h observations. Three looks is the point of the schedule, and
 * all three come through here — `first_seen` is offset 0, not a separate path (see `schedule.ts`).
 */
export async function tokensDueSecurity(
  db: Db,
  stage: SecurityStage,
  now: Date,
  limit = 50,
): Promise<Array<{ tokenId: string; network: string; address: string }>> {
  const offsetMs = SECURITY_STAGE_OFFSETS_MS[stage];
  const rows = await db.query<{ token_id: string; network: string; address: string }>(
    `select t.token_id, t.network, t.address
       from dex_tokens t
      where t.first_seen_at <= $1
        and not exists (
          select 1 from dex_token_security s
           where s.token_id = t.token_id and s.at_stage = $2
             and (s.answered or s.attempts >= $4))
      order by t.first_seen_at
      limit $3`,
    [new Date(now.getTime() - offsetMs), stage, limit, MAX_SECURITY_ATTEMPTS],
  );
  return rows.map((r) => ({ tokenId: r.token_id, network: r.network, address: r.address }));
}

/**
 * How often each GoPlus field was actually answered, per chain family, over a window.
 *
 * **The only form in which a shape change is detectable here.** GoPlus's EVM payload varies per
 * token — two real responses share 5 of 29 field names — so one absent field says nothing, and
 * "this field vanished from the API" exists only as a rate: 90 % of tokens carrying a field and
 * then 0 % is the signal. Without this read, `absent_fields` would be an honesty column with no
 * consumer, which is the trap it was added to avoid.
 *
 * Only `answered` rows count. A failed ask carries no information about the venue's field set, and
 * including it would make an outage look like a vanished field.
 */
export async function dexFieldPresence(
  db: Db,
  fields: readonly string[],
  since: Date,
): Promise<Array<{ chainFamily: string; field: string; answered: number; present: number }>> {
  const rows = await db.query<{ chain_family: string; field: string; answered: string; present: string }>(
    `select s.chain_family, f.field,
            count(*) as answered,
            count(*) filter (where not (f.field = any(s.absent_fields))) as present
       from dex_token_security s
       cross join unnest($2::text[]) as f(field)
      where s.answered and s.checked_at >= $1
      group by 1, 2
      order by 1, 2`,
    [since, [...fields]],
  );
  return rows.map((r) => ({
    chainFamily: r.chain_family,
    field: r.field,
    answered: Number(r.answered),
    present: Number(r.present),
  }));
}

/**
 * The same presence counts, **per UTC day** — the series a baseline needs.
 *
 * With no always-present EVM field left, the rate is the ONLY way a disappearing field can ever be
 * noticed, which makes it load-bearing rather than supplementary. An alarm needs a threshold and a
 * threshold needs a baseline, so this exposes the history that is already stored: every answered
 * row carries `checked_at` and `absent_fields`, so the series is derivable for any past window
 * without a new table.
 *
 * **The alarm is deliberately absent.** One window is not a baseline — the same reason the
 * GeckoTerminal ceiling needed two occasions and a warm-up needed a population. What would justify
 * one: several days of these rows showing a stable floor per field, after which "below its own
 * observed floor, over a population of at least N" is a measured threshold rather than a guess.
 * Until then the number is reported and a human reads it, and that is stated rather than implied.
 *
 * `date_trunc('day', checked_at at time zone 'UTC')` and not a bare `date_trunc`: the session zone
 * would otherwise decide where a day starts, which is the defect IB-043 fixed on month labels.
 */
export async function dexFieldPresenceByDay(
  db: Db,
  fields: readonly string[],
  since: Date,
): Promise<Array<{ day: string; chainFamily: string; field: string; answered: number; present: number }>> {
  const rows = await db.query<{
    day: string; chain_family: string; field: string; answered: string; present: string;
  }>(
    `select to_char(date_trunc('day', s.checked_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
            s.chain_family, f.field,
            count(*) as answered,
            count(*) filter (where not (f.field = any(s.absent_fields))) as present
       from dex_token_security s
       cross join unnest($2::text[]) as f(field)
      where s.answered and s.checked_at >= $1
      group by 1, 2, 3
      order by 1, 2, 3`,
    [since, [...fields]],
  );
  return rows.map((r) => ({
    day: r.day,
    chainFamily: r.chain_family,
    field: r.field,
    answered: Number(r.answered),
    present: Number(r.present),
  }));
}

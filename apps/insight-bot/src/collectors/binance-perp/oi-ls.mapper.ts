import { LongShortKind, LongShortRow, OpenInterestRow, Source } from '../writers/tables';

/**
 * architecture/insight-bot-system-design.md §4.1 — the `/futures/data` payloads, mapped to the
 * §3.3 rows. Pure, and spec'd against payloads captured live from `fapi.binance.com` on
 * 2026-09-28 (`test/fixtures/binance/`).
 *
 * Binance returns every number as a string; parsing happens here, once, at the boundary.
 */

export const VENUE = 'binance';

/** `/futures/data/openInterestHist?period=5m` */
export interface OpenInterestHistRow {
  symbol: string;
  sumOpenInterest: string;
  sumOpenInterestValue: string;
  /** Present in the payload, unused: a CMC supply figure, not a venue measurement. */
  CMCCirculatingSupply?: string;
  timestamp: number;
}

/**
 * `topLongShortPositionRatio`, `topLongShortAccountRatio`, `globalLongShortAccountRatio` — the
 * same shape, differing only in what is being counted, which is the `kind` column (§3.3).
 */
export interface LongShortAccountRow {
  symbol: string;
  longAccount: string;
  shortAccount: string;
  longShortRatio: string;
  timestamp: number;
}

/**
 * `takerlongshortRatio` — a different shape: volumes, not account shares, and **no `symbol`
 * field** in the response (confirmed live 2026-09-28), so the caller supplies the symbol it
 * asked for.
 */
export interface TakerRatioRow {
  buySellRatio: string;
  buyVol: string;
  sellVol: string;
  timestamp: number;
}

function num(value: string | undefined, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Binance payload: '${field}' is not a number (${String(value)})`);
  return parsed;
}

function at(timestamp: number): Date {
  if (!Number.isFinite(timestamp) || timestamp <= 0) throw new Error(`Binance payload: bad timestamp ${String(timestamp)}`);
  return new Date(timestamp);
}

/**
 * `sumOpenInterest` is the base-asset OI, `sumOpenInterestValue` the same figure in quote at the
 * venue's mark price (measured in signal-server's SE-A2 join check: value / interest matches
 * Binance's 1m mark close to 0.00 bps median). Both are stored; nothing is recomputed.
 */
export function mapOpenInterestHist(rows: readonly OpenInterestHistRow[], symbol: string, source: Source): OpenInterestRow[] {
  return rows.map((row) => ({
    venue: VENUE,
    symbol,
    ts: at(row.timestamp),
    oiBase: num(row.sumOpenInterest, 'sumOpenInterest'),
    oiQuote: num(row.sumOpenInterestValue, 'sumOpenInterestValue'),
    source,
  }));
}

export function mapLongShortAccount(
  rows: readonly LongShortAccountRow[],
  symbol: string,
  kind: Extract<LongShortKind, 'top_position' | 'top_account' | 'global_account'>,
  source: Source,
): LongShortRow[] {
  return rows.map((row) => ({
    venue: VENUE,
    symbol,
    ts: at(row.timestamp),
    kind,
    longRatio: num(row.longAccount, 'longAccount'),
    shortRatio: num(row.shortAccount, 'shortAccount'),
    ratio: num(row.longShortRatio, 'longShortRatio'),
    source,
  }));
}

/**
 * The taker rows carry volumes rather than shares. They are normalised to the same three columns
 * so `long_short_5m` stays one table: `long_ratio` / `short_ratio` are the buy and sell shares of
 * that slot's taker volume, and `ratio` is the venue's own `buySellRatio`.
 *
 * A slot with no taker volume at all gives `null` shares, not `0.5` and not `0` — there is no
 * measurement to report, and §2.3's null-not-zero rule applies (the venue's own `buySellRatio`
 * is still stored as sent).
 */
export function mapTakerRatio(rows: readonly TakerRatioRow[], symbol: string, source: Source): LongShortRow[] {
  return rows.map((row) => {
    const buy = num(row.buyVol, 'buyVol');
    const sell = num(row.sellVol, 'sellVol');
    const total = buy + sell;
    return {
      venue: VENUE,
      symbol,
      ts: at(row.timestamp),
      kind: 'taker' as const,
      longRatio: total > 0 ? buy / total : null,
      shortRatio: total > 0 ? sell / total : null,
      ratio: num(row.buySellRatio, 'buySellRatio'),
      source,
    };
  });
}

/** The three account-ratio endpoints, and the `kind` each one lands in (§4.1). */
export const ACCOUNT_RATIO_ENDPOINTS: ReadonlyArray<{
  endpoint: string;
  kind: Extract<LongShortKind, 'top_position' | 'top_account' | 'global_account'>;
}> = [
  { endpoint: 'topLongShortPositionRatio', kind: 'top_position' },
  { endpoint: 'topLongShortAccountRatio', kind: 'top_account' },
  { endpoint: 'globalLongShortAccountRatio', kind: 'global_account' },
];

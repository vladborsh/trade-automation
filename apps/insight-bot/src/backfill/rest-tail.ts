/**
 * IB-012 — the REST tail (§5): the hours the archive does not cover yet, and the two venues that
 * have no archive at all.
 *
 * Deliberately separate from IB-005's `PerpRest`: that class is the live collector's contract
 * (a couple of bars, one funding row), while this pages a range under a weight throttle. Sharing
 * one class would give each caller the other's constraints.
 *
 * Depth facts honoured here, all measured (§5):
 * - **Bybit** funding serves from listing, so it pages until it reaches rows we already store.
 * - **OKX** funding serves only about the **last 97 days**. Reaching that wall is the expected
 *   end of the walk, not a failure, and every day OKX is not collected is lost for good.
 */

import type { WeightThrottle } from '@trade-automation/binance-client';
import type { Candle1mRow, FundingSettlementRow, Market } from '../collectors/writers/tables';

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

export const BINANCE_KLINE_PAGE = 1000;
/** `/klines` with limit ≤ 1000 costs 2 weight on both the spot and the USD-M futures API. */
export const BINANCE_KLINE_WEIGHT = 2;
/** Measured: OKX funding history reaches back roughly 97 days and no further. */
export const OKX_FUNDING_DAYS = 97;

const MINUTE_MS = 60_000;

export interface RestTailOptions {
  fetchImpl: FetchLike;
  throttle: WeightThrottle;
  timeoutMs?: number;
}

/**
 * Binance 1m klines for `[startMs, endMs)`, paged. Each response's
 * `X-MBX-USED-WEIGHT-1M` goes to the throttle, which is what makes the cap the venue's and not
 * only ours.
 */
export async function binanceKlineRange(
  options: RestTailOptions,
  market: Market,
  symbol: string,
  startMs: number,
  endMs: number,
): Promise<Candle1mRow[]> {
  const base = market === 'perp' ? 'https://fapi.binance.com/fapi/v1/klines' : 'https://api.binance.com/api/v3/klines';
  const out: Candle1mRow[] = [];
  let cursor = startMs;

  while (cursor < endMs) {
    await options.throttle.acquire(BINANCE_KLINE_WEIGHT);
    const url = `${base}?symbol=${symbol}&interval=1m&startTime=${cursor}&endTime=${endMs - 1}&limit=${BINANCE_KLINE_PAGE}`;
    const response = await options.fetchImpl(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 20_000) });
    options.throttle.observeHeader(Number(response.headers.get('x-mbx-used-weight-1m')));
    if (!response.ok) throw new Error(`binance klines HTTP ${response.status} for ${symbol}`);

    const page = (await response.json()) as unknown[][];
    if (page.length === 0) break;
    for (const row of page) {
      out.push({
        venue: 'binance', market, symbol,
        openTime: new Date(Number(row[0])),
        open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]),
        volume: Number(row[5]), quoteVolume: Number(row[7]), trades: Number(row[8]),
        takerBuyVolume: Number(row[9]), takerBuyQuoteVolume: Number(row[10]),
        source: 'rest',
      });
    }
    const lastOpen = Number(page[page.length - 1][0]);
    if (!Number.isFinite(lastOpen) || lastOpen + MINUTE_MS <= cursor) break; // no forward progress
    cursor = lastOpen + MINUTE_MS;
    if (page.length < BINANCE_KLINE_PAGE) break;
  }
  return out;
}

/** `/fapi/v1/fundingRate` costs 1 weight and serves 1000 settlements a page. */
export const BINANCE_FUNDING_WEIGHT = 1;
export const BINANCE_FUNDING_PAGE = 1000;

/**
 * Binance settled funding for `[startMs, now]` — the tail the monthly archive does not cover
 * yet, which is everything since the last complete month.
 */
export async function binanceFundingRange(
  options: RestTailOptions,
  symbol: string,
  startMs: number,
  endMs: number,
): Promise<FundingSettlementRow[]> {
  const out: FundingSettlementRow[] = [];
  let cursor = startMs;

  for (let page = 0; page < 200; page++) {
    if (cursor >= endMs) break;
    await options.throttle.acquire(BINANCE_FUNDING_WEIGHT);
    const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&startTime=${cursor}&endTime=${endMs}&limit=${BINANCE_FUNDING_PAGE}`;
    const response = await options.fetchImpl(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 20_000) });
    options.throttle.observeHeader(Number(response.headers.get('x-mbx-used-weight-1m')));
    if (!response.ok) throw new Error(`binance fundingRate HTTP ${response.status} for ${symbol}`);

    const rows = (await response.json()) as Array<{ fundingTime: number; fundingRate: string; markPrice?: string }>;
    if (rows.length === 0) break;
    for (const row of rows) {
      const rate = Number(row.fundingRate);
      if (!Number.isFinite(rate)) continue;
      out.push({
        venue: 'binance', symbol, fundingTime: new Date(row.fundingTime), rate,
        markPrice: row.markPrice !== undefined && row.markPrice !== '' ? Number(row.markPrice) : null,
        source: 'rest',
      });
    }
    const last = Number(rows[rows.length - 1].fundingTime);
    if (!Number.isFinite(last) || last + 1 <= cursor) break;
    cursor = last + 1;
    if (rows.length < BINANCE_FUNDING_PAGE) break;
  }
  return out;
}

/**
 * IB-BUG-003 — the stand-alone `okxFundingHistory` that lived here is gone: the backfill now
 * calls `OkxRest.fundingHistory` (IB-009), so the venue's paging, error handling and retention
 * edge have one implementation. This file keeps only the floor, which is the backfill's own
 * policy rather than the venue's behaviour.
 */
export const OKX_REST_BASE_URL = 'https://www.okx.com';

/** The earliest settlement OKX can still serve, as a timestamp. */
export function okxFundingFloor(now = Date.now()): number {
  return now - OKX_FUNDING_DAYS * 86_400_000;
}

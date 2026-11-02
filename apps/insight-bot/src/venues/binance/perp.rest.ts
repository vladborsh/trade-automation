import type { BinanceRestKline } from '@trade-automation/binance-client';
import type { FundingRateRow, PremiumIndexRow } from './payloads';

/**
 * IB-005 — the REST calls this collector makes itself, beside the lifted kline paginator.
 *
 * Weight budget (design §4.5, D15):
 * - steady state: only gap repair calls REST (`/fapi/v1/klines`, weight 5 per repaired range) plus
 *   one `fundingRate` (weight 1) per symbol per settlement — **≈ 0.1 weight/min**;
 * - degraded mode (§16.1): `klines?limit=2` per symbol (weight 1) at 3 s for the signal set and
 *   15 s for the rest, plus one symbol-less `premiumIndex` (weight 10) per minute — **≈ 178
 *   weight/min for a 30-symbol universe, ~7 % of the 2400 budget**, and only while degraded.
 *
 * Every response's `x-mbx-used-weight-1m` header is reported through `onWeight`, which the
 * collector forwards to `MetricsService.setBinanceWeightUsed1m` (§6.1's `ib_binance_weight_used_1m`).
 */

import { BinanceRest, type BinanceRestOptions } from './rest.base';

/** IB-006: the shared mechanics moved to `rest.base.ts`; these three paths are perp's. */
export type PerpRestOptions = BinanceRestOptions;

/** `/fapi/v1/fundingRate`'s `limit` ceiling (venue docs). */
export const FUNDING_RANGE_LIMIT = 1000;

export class PerpRest extends BinanceRest {
  /** The last `limit` 1m klines of one symbol — degraded mode's replacement for the kline stream. */
  async klines(symbol: string, limit = 2): Promise<BinanceRestKline[]> {
    return this.get<BinanceRestKline[]>(`/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=${limit}`);
  }

  /** Mark price, index price and predicted funding for EVERY symbol in one call (weight 10). */
  async premiumIndex(): Promise<PremiumIndexRow[]> {
    const body = await this.get<PremiumIndexRow[] | PremiumIndexRow>('/fapi/v1/premiumIndex');
    return Array.isArray(body) ? body : [body];
  }

  /**
   * WD-008: one symbol's mark price and predicted funding (weight 1, against `premiumIndex()`'s 10
   * for every symbol) — the on-demand funding panel's "predicted" point.
   */
  async premiumIndexOf(symbol: string): Promise<PremiumIndexRow> {
    return this.get<PremiumIndexRow>(`/fapi/v1/premiumIndex?symbol=${symbol}`);
  }

  /**
   * WD-008: settled funding in `[startTime, endTime]`, oldest first, up to `limit` (venue max 1000)
   * rows — weight 1 by the WD-008 budget. 1000 settlements is 333 days at 8 h, so one call covers any
   * window the funding panel asks for.
   */
  async fundingRateRange(symbol: string, startTime: number, endTime: number, limit = FUNDING_RANGE_LIMIT): Promise<FundingRateRow[]> {
    return this.get<FundingRateRow[]>(
      `/fapi/v1/fundingRate?symbol=${symbol}&startTime=${startTime}&endTime=${endTime}&limit=${limit}`,
    );
  }

  /** The settled funding rate of one symbol, newest first (§4.1: fetched when `nextFundingTime` rolls). */
  async fundingRate(symbol: string, limit = 1): Promise<FundingRateRow[]> {
    return this.get<FundingRateRow[]>(`/fapi/v1/fundingRate?symbol=${symbol}&limit=${limit}`);
  }
}

import type { BinanceRestKline } from '@trade-automation/binance-client';
import { BinanceRest, type BinanceRestOptions } from '../binance-common/rest';

/**
 * IB-006 §4.2 — spot's one REST path, on `api.binance.com`.
 *
 * Weight budget: repair only (§4.5) — `/api/v3/klines` is weight 2 for `limit <= 100`, against
 * spot's **own** 6000/min ceiling. Its `x-mbx-used-weight-1m` header is reported through
 * `onWeight` into `ib_binance_spot_weight_used_1m`, never into the futures gauge: each figure has
 * to stay comparable with its own budget (§6.1).
 */
export type SpotRestOptions = BinanceRestOptions;

/** Spot's `klines` page cap — 1000, where USD-M allows 1500 (venue docs, §4.2). */
export const SPOT_REST_PAGE_LIMIT = 1000;

export class SpotRest extends BinanceRest {
  /** The last `limit` 1m klines of one symbol — degraded mode's replacement for the kline stream. */
  async klines(symbol: string, limit = 2): Promise<BinanceRestKline[]> {
    return this.get<BinanceRestKline[]>(`/api/v3/klines?symbol=${symbol}&interval=1m&limit=${limit}`);
  }

  /** One page of 1m klines in `[from, to]`, for gap repair and the boot backfill. */
  async klineRange(symbol: string, from: number, to: number, limit = SPOT_REST_PAGE_LIMIT): Promise<BinanceRestKline[]> {
    return this.get<BinanceRestKline[]>(
      `/api/v3/klines?symbol=${symbol}&interval=1m&startTime=${from}&endTime=${to}&limit=${limit}`,
    );
  }
}

import type { Candle, Instrument, Timeframe } from '@trade-automation/contracts';
import { mapRestKline } from '@trade-automation/binance-client';
import type { CandleSource } from '@trade-automation/market-data-core';
import { SPOT_REST_PAGE_LIMIT, type SpotRest } from '../../venues/binance/spot.rest';

/** 1m in ms — the only timeframe a collector repairs (§4.1: everything else is resampled). */
const MINUTE_MS = 60_000;

/**
 * IB-006 — the `CandleSource` gap repair and the boot backfill read spot history through.
 *
 * It paginates `SpotRest.klineRange` rather than reusing `BinanceAdapter`, for two reasons:
 * the adapter's REST path is `/fapi/v1/klines` with a 1500-row page (spot is `/api/v3/klines`,
 * capped at 1000), and its plain `fetch` reports no weight — going through `SpotRest` means every
 * repair call's `x-mbx-used-weight-1m` lands on `ib_binance_spot_weight_used_1m` (§6.1), which is
 * the figure that has to stay comparable with spot's own 6000/min ceiling.
 */
export class SpotCandleSource implements CandleSource {
  constructor(private readonly rest: SpotRest) {}

  async fetchCandles(instrument: Instrument, tf: Timeframe, from: number, to: number): Promise<Candle[]> {
    if (tf !== '1m') throw new Error(`binance-spot repairs 1m only, asked for ${tf}`);
    const out: Candle[] = [];
    let cursor = from;
    while (cursor <= to) {
      const rows = await this.rest.klineRange(instrument.symbol, cursor, to);
      if (rows.length === 0) break;
      out.push(...rows.map((row) => mapRestKline(instrument.id, row, tf)));
      const lastOpenTime = rows[rows.length - 1][0];
      if (rows.length < SPOT_REST_PAGE_LIMIT || lastOpenTime >= to) break;
      cursor = lastOpenTime + MINUTE_MS;
    }
    return out;
  }
}

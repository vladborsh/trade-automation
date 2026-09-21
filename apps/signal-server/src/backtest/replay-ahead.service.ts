import { Inject, Injectable } from '@nestjs/common';
import { AheadResponse, Candle, InstrumentId } from '@trade-automation/contracts';
import { CANDLE_STORE, CandleStore } from '../storage/candle-store.port';
import { aheadEnd, toCompactTuple } from './replay-window';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * architecture/backtest-app-system-design.md §5.3, §7.2 — GET …/candles/ahead: up to `limit`
 * 1m candles with `openTime >= fromMs`, as compact tuples, clamped to the session period.
 * **Not bounded by the cursor**: this endpoint deliberately hands the client the future (§5.3).
 *
 * Reads one UTC day of 1m at a time (the store's unit) and fetches one candle more than asked,
 * so `endOfTape` is exact: true only when nothing further exists inside the period.
 */
@Injectable()
export class ReplayAheadService {
  constructor(@Inject(CANDLE_STORE) private readonly store: CandleStore) {}

  async ahead(instrument: InstrumentId, fromMs: number, limit: number, periodToMs: number): Promise<AheadResponse> {
    const found: Candle[] = [];
    const coverage = await this.store.coverage(instrument, '1m');
    if (coverage) {
      const stop = Math.min(aheadEnd(periodToMs), coverage.to + 1);
      let from = Math.max(fromMs, coverage.from);
      while (found.length <= limit && from < stop) {
        const to = Math.min(Math.floor(from / DAY_MS) * DAY_MS + DAY_MS, stop);
        found.push(...(await this.store.query(instrument, '1m', from, to - 1)));
        from = to;
      }
    }
    return {
      candles: found.slice(0, limit).map(toCompactTuple),
      endOfTape: found.length <= limit,
    };
  }
}

import { Controller, Get, Inject, Query, UsePipes } from '@nestjs/common';
import { CandlesQuerySchema, CandlesResponse } from '@trade-automation/contracts';
import { CandleCache } from '../../market-data/candle-cache.service';
import { CANDLE_STORE, CandleStore } from '../../storage/candle-store.port';
import { ZodValidationPipe } from '../zod-validation.pipe';

/**
 * architecture/live-signal-server.md §3.5, §4.5 — GET /api/candles. "History serving prefers
 * CandleCache; cache-miss falls through to CandleStore.query."
 */
@Controller('api/candles')
export class CandlesController {
  constructor(
    private readonly cache: CandleCache,
    @Inject(CANDLE_STORE) private readonly store: CandleStore,
  ) {}

  @Get()
  @UsePipes(new ZodValidationPipe(CandlesQuerySchema))
  async get(@Query() query: ReturnType<typeof CandlesQuerySchema.parse>): Promise<CandlesResponse> {
    const { instrument, timeframe, from, to, limit } = query;

    // Prefer the cache for whatever tail it actually holds (it is the only source for
    // derived timeframes that are never persisted, base §4.3's "1m + what a strategy
    // needs" rule), and fall back to the store only for the older portion, if any, that
    // the cache's ring buffer no longer retains. `covers()` (requiring the cache's
    // earliest bar to be at or before `from`) is too strict for a "give me the latest
    // bars" query with a wide-open `from` (e.g. 0) — it would reject a cache that has
    // perfectly good recent data just because it doesn't reach all the way back.
    const cached = this.cache.query(instrument, timeframe, from, to);
    let candles: typeof cached;
    if (cached.length > 0) {
      const storeTo = cached[0].openTime - 1;
      const older = from <= storeTo ? await this.store.query(instrument, timeframe, from, storeTo) : [];
      candles = [...older, ...cached];
    } else {
      candles = await this.store.query(instrument, timeframe, from, to);
    }

    return candles.slice(Math.max(0, candles.length - limit));
  }
}

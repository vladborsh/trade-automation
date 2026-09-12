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

    const candles = this.cache.covers(instrument, timeframe, from)
      ? [...this.cache.query(instrument, timeframe, from, to)]
      : await this.store.query(instrument, timeframe, from, to);

    return candles.slice(Math.max(0, candles.length - limit));
  }
}

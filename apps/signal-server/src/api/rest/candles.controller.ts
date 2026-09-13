import { Controller, Get, Inject, Query, Res, UsePipes } from '@nestjs/common';
import {
  Candle,
  CandlesQuerySchema,
  CandlesResponse,
  VENDOR_FLOOR_DATE_HEADER,
  VENDOR_FLOOR_REACHED_HEADER,
  Venue,
} from '@trade-automation/contracts';
import { AppConfigService } from '../../config/config.service';
import { CandleCache } from '../../market-data/candle-cache.service';
import { CAP_COM_INTRADAY_FLOOR_MS } from '../../market-data/capitalcom/capitalcom.mapper';
import { CapComPriceNotFoundError } from '../../market-data/capitalcom/capitalcom.adapter';
import { VenueAdapter } from '../../market-data/venue-adapter.port';
import { VENUE_ADAPTERS_MAP } from '../../market-data/venue-adapters.provider';
import { CANDLE_STORE, CandleStore } from '../../storage/candle-store.port';
import { ZodValidationPipe } from '../zod-validation.pipe';

/** §12.2 — Capital.com timeframes where the 2024-01-02 intraday floor is confirmed (§12.4). */
const CAP_COM_HARD_WALL_TIMEFRAMES = new Set(['1m', '5m', '15m']);

// Minimal structural type instead of express's `Response` — this app doesn't otherwise depend
// on `@types/express` (only `@nestjs/platform-express`'s own runtime), and all this needs is
// `setHeader` on whatever HTTP-platform response object Nest injects via `@Res({ passthrough }).
interface HeaderSettableResponse {
  setHeader(name: string, value: string): void;
}

/**
 * architecture/live-signal-server.md §3.5, §4.5, §12.2, §12.5 item 4 — GET /api/candles.
 * "History serving prefers CandleCache; cache-miss falls through to CandleStore.query", and now:
 * a genuine store-miss (the request reaches further back than either holds) triggers an
 * on-demand fetch-and-persist from the venue — always for Binance, and for Capital.com only for
 * timeframe/date ranges the venue actually serves (the confirmed 2024-01-02 intraday floor is a
 * hard wall with no fetch attempt at all; `1h`/`4h`/`1d` are attempted since their floor is
 * deeper but unconfirmed, and a 404 there is treated the same as hitting the wall).
 */
@Controller('api/candles')
export class CandlesController {
  constructor(
    private readonly config: AppConfigService,
    private readonly cache: CandleCache,
    @Inject(CANDLE_STORE) private readonly store: CandleStore,
    @Inject(VENUE_ADAPTERS_MAP) private readonly adapters: Map<Venue, VenueAdapter>,
  ) {}

  @Get()
  @UsePipes(new ZodValidationPipe(CandlesQuerySchema))
  async get(
    @Query() query: ReturnType<typeof CandlesQuerySchema.parse>,
    @Res({ passthrough: true }) res: HeaderSettableResponse,
  ): Promise<CandlesResponse> {
    const { instrument, timeframe, from, to, limit } = query;

    // Prefer the cache for whatever tail it actually holds (it is the only source for
    // derived timeframes that are never persisted, base §4.3's "1m + what a strategy
    // needs" rule), and fall back to the store only for the older portion, if any, that
    // the cache's ring buffer no longer retains. `covers()` (requiring the cache's
    // earliest bar to be at or before `from`) is too strict for a "give me the latest
    // bars" query with a wide-open `from` (e.g. 0) — it would reject a cache that has
    // perfectly good recent data just because it doesn't reach all the way back.
    const cached = this.cache.query(instrument, timeframe, from, to);
    let candles: Candle[];
    if (cached.length > 0) {
      const storeTo = cached[0].openTime - 1;
      const older = from <= storeTo ? await this.store.query(instrument, timeframe, from, storeTo) : [];
      candles = [...older, ...cached];
    } else {
      candles = await this.store.query(instrument, timeframe, from, to);
    }

    // §12.2/§12.5 item 4: a store-miss is "we still don't reach back to `from`" — not merely
    // "the array is empty" (an empty `[from, to]` window inside otherwise-covered history is a
    // legitimate answer, e.g. a request for a session with no trades).
    const earliestHeld = candles.length > 0 ? candles[0].openTime : null;
    const needsFetch = earliestHeld === null ? true : earliestHeld > from;

    if (needsFetch) {
      const instrumentCfg = this.config.instruments.find((i) => i.id === instrument);
      const adapter = instrumentCfg ? this.adapters.get(instrumentCfg.venue) : undefined;
      const fetchTo = earliestHeld !== null ? earliestHeld - 60_000 : to;

      if (instrumentCfg && adapter && fetchTo >= from) {
        if (instrumentCfg.venue === 'capitalcom' && this.belowCapComHardWall(timeframe, from)) {
          this.setVendorFloorHeaders(res, CAP_COM_INTRADAY_FLOOR_MS);
        } else {
          try {
            const fetched = await adapter.fetchCandles(instrumentCfg, timeframe, from, fetchTo);
            if (fetched.length > 0) {
              await this.store.upsert(fetched);
              candles = [...fetched, ...candles];
            } else if (instrumentCfg.venue === 'capitalcom') {
              // Venue served an empty page for a range it didn't outright 404 on — treat the
              // same as reaching the floor rather than silently returning nothing forever.
              this.setVendorFloorHeaders(res, null);
            }
          } catch (err) {
            if (instrumentCfg.venue === 'capitalcom' && err instanceof CapComPriceNotFoundError) {
              this.setVendorFloorHeaders(res, null);
            } else {
              throw err; // Binance (or any other adapter error): surface it, never mask as empty
            }
          }
        }
      }
    }

    return candles.slice(Math.max(0, candles.length - limit));
  }

  private belowCapComHardWall(timeframe: string, from: number): boolean {
    return CAP_COM_HARD_WALL_TIMEFRAMES.has(timeframe) && from < CAP_COM_INTRADAY_FLOOR_MS;
  }

  private setVendorFloorHeaders(res: HeaderSettableResponse, floorDateMs: number | null): void {
    res.setHeader(VENDOR_FLOOR_REACHED_HEADER, 'true');
    if (floorDateMs !== null) {
      res.setHeader(VENDOR_FLOOR_DATE_HEADER, new Date(floorDateMs).toISOString());
    }
  }
}

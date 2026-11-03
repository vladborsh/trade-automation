import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/config.service';
import { BinanceWeightTracker } from './binance/binance-weight.tracker';
import { FuturesDataClient } from './binance/futures-data.client';
import { PerpRest } from './binance/perp.rest';
import { BybitRest } from './bybit/bybit.rest';
import { OkxRest } from './okx/okx-rest';
import { TtlCache } from './ttl-cache';

/**
 * WD-008 — the venue clients the on-demand layer reads through, built once from config.
 *
 * **`BinanceWeightTracker` is a singleton HERE** (it was OpsModule's, IB-063). OpsModule imports and
 * re-exports this module, so the collectors, the admin health page (`/api/web/health/streams`), `/metrics` and every on-demand read still
 * record into ONE instance — two trackers would each report half of what the IP spent, and the
 * 1 800/min refusal would be checked against the smaller half.
 *
 * One `TtlCache` for the whole process (bounded; `ttl-cache.ts`). Nothing in this module writes to
 * Postgres, and nothing here may: that is the point of the on-demand layer.
 */
@Module({
  imports: [AppConfigModule],
  providers: [
    BinanceWeightTracker,
    { provide: TtlCache, useFactory: () => new TtlCache() },
    {
      provide: FuturesDataClient,
      inject: [AppConfigService, BinanceWeightTracker],
      useFactory: (config: AppConfigService, weight: BinanceWeightTracker) =>
        new FuturesDataClient({ baseUrl: config.env.get('BINANCE_FUTURES_REST_BASE_URL'), weight }),
    },
    {
      // the venue's own used-weight header lands in the shared tracker; callers add the documented cost
      provide: PerpRest,
      inject: [AppConfigService, BinanceWeightTracker],
      useFactory: (config: AppConfigService, weight: BinanceWeightTracker) =>
        new PerpRest({ baseUrl: config.env.get('BINANCE_FUTURES_REST_BASE_URL'), onWeight: (used) => weight.recordHeader(used) }),
    },
    { provide: BybitRest, useFactory: () => new BybitRest() },
    {
      provide: OkxRest,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => new OkxRest({ baseUrl: config.env.get('OKX_REST_BASE_URL') }),
    },
  ],
  exports: [BinanceWeightTracker, TtlCache, FuturesDataClient, PerpRest, BybitRest, OkxRest],
})
export class VenuesModule {}

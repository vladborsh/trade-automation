import { Module, type DynamicModule, Logger } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/config.service';
import { DbModule } from '../db/db.module';
import { OpsModule } from '../ops/ops.module';
import { CalendarController } from './calendar/calendar.controller';
import { WebAuthController } from './auth/web-auth.controller';
import { WebAuthGuard } from './auth/web-auth.guard';
import { WebAuthService } from './auth/web-auth.service';
import { CredentialsService } from './auth/credentials.service';
import { LoginGuard } from './auth/login-throttle';
import { PasswordHasher } from './auth/password';
import { WebAdminController } from './admin/login-events.controller';
import { AssetClassifier } from './liquidations/asset-classes';
import { WebContextController } from './context/context.controller';
import { WebMarketController } from './market/market.controller';
import { CapsService } from './market/caps.service';
import { WebHealthController } from './health.controller';
import { SeriesController } from './series/series.controller';
import { LiquidationsController } from './liquidations/liquidations.controller';
import { LiquidationsOverviewService } from './liquidations/overview.service';
import { MarketCardsService } from './market/market-cards.service';
import { CandlesService } from './market/candles.service';
import { BinanceWeightTracker } from '../venues/binance/binance-weight.tracker';
import { MetricsService } from '../ops/metrics.service';
import { UniverseSummaryService } from './market/universe-summary.service';
import { FundingService } from './market/funding.service';
import { OiLsService } from './market/oi-ls.service';
import { DB, type Db } from '../db/db.port';
import { oiLsStoredReader } from './series/pg/oi-ls-stored.repo';
import { TtlCache } from '../venues/ttl-cache';
import { FuturesDataClient } from '../venues/binance/futures-data.client';
import { PerpRest } from '../venues/binance/perp.rest';
import { BybitRest } from '../venues/bybit/bybit.rest';
import { OkxRest } from '../venues/okx/okx-rest';
import { UniverseController } from './universe.controller';
import { WebPushController } from './push/push.controller';

/**
 * IB-029 — the dashboard's server surface (architecture/insight-bot-web-dashboard.md §4).
 *
 * **The guard is module-wide, not per-controller** (Tech Lead's ruling): it is registered as an
 * `APP_GUARD` and enforces on the `/api/web` prefix, so every controller added here later —
 * IB-030's `health.ts` and `coverage.ts`, and the pages after them — is authenticated by
 * default and nobody has to remember a decorator. Routes outside `/api/web`, including the
 * unauthenticated ops `/health` and `/metrics`, are untouched by it.
 *
 * Opting a route out is explicit and rare: `@Public()` (the token exchange, which arrives
 * without a cookie, and logout, which must clear a dead cookie rather than 401).
 *
 * Registered only when there is a database, like the other feature modules: sessions are rows.
 */
@Module({})
export class WebModule {
  static register(): DynamicModule {
    const enabled = typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.length > 0;
    if (!enabled) {
      new Logger(WebModule.name).warn('DATABASE_URL is not set — the web dashboard API is disabled');
      return { module: WebModule };
    }
    return {
      module: WebModule,
      // IB-030: the health page reads the live StreamRegistry and the weight gauges, which
      // OpsModule owns and exports — the same instances /health and /metrics report, so the
      // dashboard cannot drift from the ops view by reading a second copy.
      imports: [AppConfigModule, DbModule, OpsModule],
      // No guard decorator on any of these — they are authenticated by the APP_GUARD above,
      // which is the whole point of it being module-wide.
      controllers: [
        WebAuthController, WebHealthController, WebAdminController,
        SeriesController, UniverseController, LiquidationsController, WebContextController,
        CalendarController, WebPushController, WebMarketController,
      ],
      providers: [
        WebAuthService,
        // IB-078: one hasher (its ScryptGate is the process-wide cap of 2 concurrent scrypt) and one
        // throttle (in-memory, per process — P7)
        { provide: PasswordHasher, useFactory: () => new PasswordHasher() },
        { provide: LoginGuard, useFactory: () => new LoginGuard() },
        CredentialsService,
        LiquidationsOverviewService,
        {
          // IB-084 (D6): universe classes + Binance exchangeInfo (weight 1, once a day) into the shared tracker
          provide: AssetClassifier,
          inject: [AppConfigService, BinanceWeightTracker],
          useFactory: (config: AppConfigService, weight: BinanceWeightTracker) =>
            new AssetClassifier({
              symbols: config.symbols,
              futuresBaseUrl: config.env.get('BINANCE_FUTURES_REST_BASE_URL'),
              onWeight: (header) => (header === null ? weight.recordCall(1) : weight.recordHeader(header)),
            }),
        },
        {
          provide: UniverseSummaryService,
          // WD-008: the shared tracker — it used to build its own, so its ~50 weight a refresh was
          // invisible to /health and to every other read's 1 800/min ceiling check
          inject: [AppConfigService, BinanceWeightTracker],
          useFactory: (config: AppConfigService, weight: BinanceWeightTracker) =>
            new UniverseSummaryService({ futuresBaseUrl: config.env.get('BINANCE_FUTURES_REST_BASE_URL'), weight }),
        },
        {
          provide: MarketCardsService,
          inject: [AppConfigService],
          useFactory: (config: AppConfigService) =>
            new MarketCardsService({
              fngBaseUrl: config.env.get('FNG_BASE_URL'),
              coingeckoBaseUrl: config.env.get('COINGECKO_BASE_URL'),
            }),
        },
        {
          // IB-087: the caps block; /global shared with the market cards, the rest via the shared TtlCache
          provide: CapsService,
          inject: [AppConfigService, TtlCache, MarketCardsService],
          useFactory: (config: AppConfigService, cache: TtlCache, cards: MarketCardsService) =>
            new CapsService({ coingeckoBaseUrl: config.env.get('COINGECKO_BASE_URL'), cache, cards }),
        },
        {
          // IB-063: the chart's candles, live from Binance; weight into the shared tracker
          provide: CandlesService,
          inject: [AppConfigService, BinanceWeightTracker, MetricsService],
          useFactory: (config: AppConfigService, weight: BinanceWeightTracker, metrics: MetricsService) =>
            new CandlesService({
              futuresBaseUrl: config.env.get('BINANCE_FUTURES_REST_BASE_URL'),
              spotBaseUrl: config.env.get('BINANCE_SPOT_REST_BASE_URL'),
              weight,
              onSpotWeight: (w) => metrics.setBinanceSpotWeightUsed1m(w),
            }),
        },
        {
          // WD-008 step 2: on-demand funding, OI and long-short — beside the tape reads, not yet routed
          provide: FundingService,
          inject: [AppConfigService, PerpRest, BybitRest, OkxRest, TtlCache, BinanceWeightTracker],
          useFactory: (config: AppConfigService, perp: PerpRest, bybit: BybitRest, okx: OkxRest, cache: TtlCache, weight: BinanceWeightTracker) =>
            new FundingService({
              perp, bybit, okx, cache, weight,
              spellings: (symbol) => {
                const entry = config.symbols.find((s) => s.id === symbol);
                return { bybit: entry?.bybit_linear, okx: entry?.okx_swap };
              },
            }),
        },
        {
          provide: OiLsService,
          // IB-080: plus the poller's tables, for windows older than the venue keeps
          inject: [FuturesDataClient, TtlCache, BinanceWeightTracker, DB],
          useFactory: (client: FuturesDataClient, cache: TtlCache, weight: BinanceWeightTracker, db: Db | null) =>
            new OiLsService({ client, cache, weight, stored: db ? oiLsStoredReader(db) : null }),
        },
        { provide: APP_GUARD, useClass: WebAuthGuard },
      ],
      exports: [WebAuthService, CredentialsService],
    };
  }
}

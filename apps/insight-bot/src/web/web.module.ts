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
import { WebContextController } from './context/context.controller';
import { WebCoverageController } from './coverage.controller';
import { WebHealthController } from './health.controller';
import { SeriesController } from './series/series.controller';
import { LiquidationsController } from './liquidations/liquidations.controller';
import { LiquidationsOverviewService } from './liquidations/overview.service';
import { MarketCardsService } from './market/market-cards.service';
import { CandlesService } from './market/candles.service';
import { BinanceWeightTracker } from '../collectors/binance-perp/binance-weight.tracker';
import { MetricsService } from '../ops/metrics.service';
import { UniverseSummaryService } from './market/universe-summary.service';
import { UniverseController } from './universe.controller';

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
        WebAuthController, WebHealthController, WebCoverageController,
        SeriesController, UniverseController, LiquidationsController, WebContextController,
        CalendarController,
      ],
      providers: [
        WebAuthService,
        LiquidationsOverviewService,
        {
          provide: UniverseSummaryService,
          inject: [AppConfigService],
          useFactory: (config: AppConfigService) =>
            new UniverseSummaryService({ futuresBaseUrl: config.env.get('BINANCE_FUTURES_REST_BASE_URL') }),
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
        { provide: APP_GUARD, useClass: WebAuthGuard },
      ],
      exports: [WebAuthService],
    };
  }
}

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
import { SessionSweeperService } from './auth/session-sweeper.service';
import { CredentialsService } from './auth/credentials.service';
import { LoginGuard } from './auth/login-throttle';
import { PasswordHasher } from './auth/password';
import { WebAdminController } from './admin/login-events.controller';
import { WebMembersController } from './members/members.controller';
import { LIQ_ALERTS_VISIBILITY, OI_ALERTS_VISIBILITY, WebMeSettingsController } from './members/me-settings.controller';
import { LIQ_ALERTS_ADMIN, WebLiqAlertsAdminController } from './admin/liq-alerts.controller';
import { LiqAlertsAdmin } from '../alerts/liquidations/liq-alerts-admin';
import { PgLiqAlertStore, PgLiqAlertsVisibility } from '../alerts/liquidations/pg/liq-alerts.repo';
import { PgOiAlertStore, PgOiAlertsVisibility } from '../alerts/oi-divergence/pg/oi-alerts.repo';
import { AlertsAdmin, cachedExchangeInfo } from '../alerts/oi-divergence/alerts-admin';
import { OiWindowReader } from '../insights/divergence/oi-window.reader';
import { ALERTS_ADMIN, WebAlertsAdminController } from './admin/alerts.controller';
import { UsersModule } from '../users/users.module';
import { AssetClassifier } from './liquidations/asset-classes';
import { WebContextController } from './context/context.controller';
import { WebMarketController } from './market/market.controller';
import { CapsService } from './market/caps.service';
import { FlowsService } from './market/flows.service';
import { WebHealthController } from './health.controller';
import { SeriesController } from './series/series.controller';
import { LiquidationsController } from './liquidations/liquidations.controller';
import { LiquidationsOverviewService } from './liquidations/overview.service';
import { LiquidationsLargeController } from './liquidations/liquidations-large.controller';
import { LiquidationsLargeService } from './liquidations/large.service';
import { LiquidationEpisodesController } from './liquidations/liquidation-episodes.controller';
import { EPISODE_PRICE_READER, LiquidationEpisodesService, type EpisodePriceReader } from './liquidations/episodes.service';
import { MarketCardsService } from './market/market-cards.service';
import { MarketCapRecorderService } from './market/market-cap/market-cap-recorder.service';
import { marketCapSince } from './market/pg/market-cap.repo';
import { CandlesService } from './market/candles.service';
import { BinanceWeightTracker } from '../venues/binance/binance-weight.tracker';
import { MetricsService } from '../ops/metrics.service';
import { UniverseSummaryService } from './market/universe-summary.service';
import { FundingService } from './market/funding.service';
import { OiLsService } from './market/oi-ls.service';
import { OiDivergenceService } from './market/oi-divergence.service';
import { DB, type Db } from '../db/db.port';
import { oiLsStoredReader } from './series/pg/oi-ls-stored.repo';
import { PositioningService } from './market/positioning/positioning.service';
import { KpisService } from './market/positioning/kpis.service';
import { InsightsService } from '../insights/insights.service';
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
 * unauthenticated ops `/healthz` and `/metrics`, are untouched by it.
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
      // OpsModule owns and exports — the same instances the admin health page and /metrics report, so the
      // dashboard cannot drift from the ops view by reading a second copy.
      imports: [AppConfigModule, DbModule, OpsModule, UsersModule],
      // No guard decorator on any of these — they are authenticated by the APP_GUARD above,
      // which is the whole point of it being module-wide.
      controllers: [
        WebAuthController, WebHealthController, WebAdminController,
        SeriesController, UniverseController, LiquidationsController, WebContextController,
        CalendarController, WebPushController, WebMarketController,
        // IB-035: the admin's members page and a member's own settings
        WebMembersController, WebMeSettingsController,
        // IB-112: the OI divergence alerts admin page
        WebAlertsAdminController,
        WebLiqAlertsAdminController,
        // IB-120: the /liquidations page
        LiquidationsLargeController,
        // IB-133: the /liquidations page as «episodes»
        LiquidationEpisodesController,
      ],
      providers: [
        WebAuthService,
        // IB-BUG-017: expired sessions, spent login tokens and the 90-day login journal are purged hourly
        SessionSweeperService,
        // IB-118: the total market cap into market_cap_total every 10 min, viewers or not
        MarketCapRecorderService,
        // IB-078: one hasher (its ScryptGate is the process-wide cap of 2 concurrent scrypt) and one
        // throttle (in-memory, per process — P7)
        { provide: PasswordHasher, useFactory: () => new PasswordHasher() },
        { provide: LoginGuard, useFactory: () => new LoginGuard() },
        CredentialsService,
        LiquidationsOverviewService,
        LiquidationsLargeService,
        LiquidationEpisodesService,
        {
          // IB-133 (E8): an episode's price path — the universe's Binance perp, ONE exact-limit 1m read (weight 2)
          provide: EPISODE_PRICE_READER,
          inject: [AppConfigService, CandlesService],
          useFactory: (config: AppConfigService, candles: CandlesService): EpisodePriceReader => ({
            binancePerp: (symbolId) => config.symbols.find((x) => x.id === symbolId)?.binance_perp ?? null,
            closedKlines1m: (symbol, fromMs, limit) => candles.closedKlines(symbol, '1m', fromMs, limit),
          }),
        },
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
          // invisible to the admin health page and to every other read's 1 800/min ceiling check
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
        {
          // IB-110 (OI divergence V11): lines computed on open — candles, our OI (the venue's for a coin we
          // do not store), the detector; cached one bar per (symbol, tf)
          provide: OiDivergenceService,
          inject: [DB, CandlesService, FuturesDataClient, TtlCache],
          useFactory: (db: Db | null, candles: CandlesService, client: FuturesDataClient, cache: TtlCache) =>
            new OiDivergenceService({ db, candles, client, cache }),
        },
        {
          // IB-085 (D9): positioning — every read through the services above, none of its own
          provide: PositioningService,
          inject: [AppConfigService, TtlCache, UniverseSummaryService, CandlesService, FundingService, OiLsService, LiquidationsOverviewService],
          useFactory: (config: AppConfigService, cache: TtlCache, summary: UniverseSummaryService, candles: CandlesService,
            funding: FundingService, oiLs: OiLsService, liquidations: LiquidationsOverviewService) =>
            new PositioningService({ symbols: config.symbols, cache, summary, candles, funding, oiLs, liquidations }),
        },
        {
          // IB-085 (D10): the KPI strip, from existing reads
          provide: KpisService,
          // IB-118: plus the funding baseline (held settlements) and market_cap_total for the 7-day charts
          inject: [AppConfigService, TtlCache, MarketCardsService, LiquidationsOverviewService, OiLsService, UniverseSummaryService, PositioningService, DB],
          useFactory: (config: AppConfigService, cache: TtlCache, cards: MarketCardsService, liquidations: LiquidationsOverviewService,
            oiLs: OiLsService, summary: UniverseSummaryService, positioning: PositioningService, db: Db | null) =>
            new KpisService({
              cache, cards, liquidations, oiLs, summary, positioning,
              capRows: db ? (sinceMs) => marketCapSince(db, sinceMs) : null,
              btcSymbol: config.symbols.find((s) => s.base === 'BTC')?.id ?? 'BTCUSDT',
            }),
        },
        {
          // IB-091: «Деривативы и потоки» — Deribit, OKX rubik, DefiLlama, Coinbase; cache only (D7), D18 premium
          provide: FlowsService,
          inject: [TtlCache, CandlesService],
          useFactory: (cache: TtlCache, candles: CandlesService) => new FlowsService({ cache, candles }),
        },
        {
          // IB-086 (D1): the insight engine lives in src/insights/; it reads these services through ports
          provide: InsightsService,
          inject: [TtlCache, LiquidationsOverviewService, PositioningService, MarketCardsService, FlowsService, DB, AppConfigService, CandlesService, OiLsService],
          useFactory: (cache: TtlCache, liquidations: LiquidationsOverviewService, positioning: PositioningService, cards: MarketCardsService,
            flows: FlowsService, db: Db | null, config: AppConfigService, candles: CandlesService, oiLs: OiLsService) => {
            // IB-119: a coin id → its Binance perp; an alert's symbol (R11) is one already and passes through
            const perp = (coin: string) => config.symbols.find((x) => x.id === coin)?.binance_perp ?? coin;
            return new InsightsService({
              cache,
              ports: {
                liquidations: async (period) => {
                  const [m, coins, overview] = await Promise.all([
                    liquidations.marketSamples(period), liquidations.coinPeriodSamples(period),
                    liquidations.overview({ topN: 20, feedMinUsd: 100_000, feedLimit: 1, period }),
                  ]);
                  // IB-107: the mirrored chart's bars from the same call — R1's chart (IB-119), no read of its own
                  const bars = overview.block.hourly.buckets.map((x) => ({ time: x.time, long: x.long, short: x.short }));
                  return { ...m, coins, large: overview.block.large, bars };
                },
                positioning: async (period) => (await positioning.positioning(period)).rows,
                // IB-135: R5 normalises funding to 8 h with the interval the table's signalOf uses
                fundingIntervalH: () => positioning.fundingIntervals(),
                // IB-113 (TL): R11 owner-first — members see it only while the admin page's members_visible is on
                oiAlertsMembersVisible: async () => (db ? new PgOiAlertsVisibility(db).membersVisible() : false),
                // IB-113 (V16): the journal's newest on-time alert of 24 h, its OI per bar from our DB — no venue call
                oiDivergence: async (nowMs) => {
                  if (!db) return null;
                  const alert = await new PgOiAlertStore(db).latestOnTime(Math.floor(nowMs / 1000));
                  return alert ? { alert } : null;
                },
                breadth: (period) => positioning.breadth(period),
                fng: async () => (await cards.cards([])).fearGreed?.now.value ?? null,
                flows: (period) => flows.flows(period),
                // IB-119 (round 2 §3): the charts' reads, for the displayed statements only (costs in insight-charts.ts)
                charts: {
                  fundingSettlements: () => positioning.fundingSettlements(),
                  hourlyCloses: (coin, fromMs) => positioning.hourlyCloses(coin, fromMs),
                  closedKlines: (coin, tf, fromMs, limit) => candles.closedKlines(perp(coin), tf, fromMs, limit),
                  openInterest: async (coin, fromMs, toMs, minPeriodMs) =>
                    (await oiLs.openInterest(perp(coin), fromMs, toMs, minPeriodMs)).points.map((p) => ({ time: p.time, value: p.value })),
                  longShort: async (coin, kind, fromMs, toMs) => (await oiLs.longShort(perp(coin), kind, fromMs, toMs)).points,
                  liquidationMinutes: (fromMs, toMs) => liquidations.minuteSides(fromMs, toMs),
                  oiReadings: async (coin, fromSec, toSec) => {
                    if (!db) return [];
                    return (await new OiWindowReader(db).read(perp(coin), fromSec, toSec)).oi5m;
                  },
                },
              },
            });
          },
        },
        {
          // IB-112 (V17): the alerts admin page; adding a coin checks Binance exchangeInfo (cached 10 min, weight 1)
          provide: ALERTS_ADMIN,
          inject: [DB, AppConfigService, BinanceWeightTracker],
          useFactory: (db: Db | null, config: AppConfigService, weight: BinanceWeightTracker) => {
            if (!db) return null;
            const url = `${String(config.env.get('BINANCE_FUTURES_REST_BASE_URL')).replace(/\/+$/, '')}/fapi/v1/exchangeInfo`;
            return new AlertsAdmin(new PgOiAlertStore(db), cachedExchangeInfo(async () => {
              const response = await fetch(url);
              const header = response.headers.get('x-mbx-used-weight-1m');
              if (header === null) weight.recordCall(1); else weight.recordHeader(Number(header));
              if (!response.ok) throw new Error(`exchangeInfo HTTP ${response.status}`);
              return response.json();
            }));
          },
        },
        {
          // IB-122 (liq design §1): the «Ликвидации» section of /admin/alerts
          provide: LIQ_ALERTS_ADMIN,
          inject: [DB],
          useFactory: (db: Db | null) => (db ? new LiqAlertsAdmin(new PgLiqAlertStore(db)) : null),
        },
        {
          // IB-122: the liquidation alerts toggle, behind alert_type_settings('liq').members_visible
          provide: LIQ_ALERTS_VISIBILITY,
          inject: [DB],
          useFactory: (db: Db | null) => (db ? new PgLiqAlertsVisibility(db) : { membersVisible: async () => false }),
        },
        {
          // IB-112 (V13): /me/settings shows members the OI alerts toggle only while members_visible is on
          provide: OI_ALERTS_VISIBILITY,
          inject: [DB],
          useFactory: (db: Db | null) => (db ? new PgOiAlertsVisibility(db) : { membersVisible: async () => false }),
        },
        { provide: APP_GUARD, useClass: WebAuthGuard },
      ],
      // IB-112: the OI divergence loop (DeliveryModule) reads klines through the same cached, weight-tracked service
      exports: [WebAuthService, CredentialsService, CandlesService],
    };
  }
}

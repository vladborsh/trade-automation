import { DynamicModule, Logger, Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { DbModule } from '../db/db.module';
import { OpsModule } from '../ops/ops.module';
import { BinancePerpService } from './binance-perp/binance-perp.service';
import { OiLsPoller } from './binance-perp/oi-ls.poller';
import { OkxService } from './okx/okx.service';
import { BybitService } from './bybit/bybit.service';
import { UptimeRecorder } from './uptime/uptime.recorder';
import { TelegramSender } from '../delivery/telegram-sender';
import { WatchdogService } from '../ops/watchdog.service';
import { WritersModule } from './writers/writers.module';

/**
 * IB-005 / IB-007 / IB-008 — the collectors, and IB-011's watchdog, registered only when there is a
 * database to write into. (WD-011 deleted IB-011's daily gap report: its candle grid went with the
 * candle tape. Liquidation gaps stay visible in `collector_gaps`, the heartbeats and
 * `/api/web/health/streams` uptime.)
 *
 * `Writers` throws without `DATABASE_URL` (IB-004), and the app must still boot without one
 * (IB-003, §2.1): so this is a dynamic module that provides nothing in that case and says why,
 * the same rule `DbModule` follows.
 */
@Module({})
export class CollectorsModule {
  static register(): DynamicModule {
    const enabled = typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.length > 0;
    if (!enabled) {
      new Logger(CollectorsModule.name).warn('DATABASE_URL is not set — collectors disabled (the app still serves /healthz and /metrics)');
      return { module: CollectorsModule };
    }
    return {
      module: CollectorsModule,
      imports: [AppConfigModule, DbModule, OpsModule, WritersModule],
      providers: [
        // BinanceWeightTracker comes from OpsModule (IB-063): one instance shared with the web module
        BinancePerpService, OiLsPoller, BybitService, OkxService,
        // IB-BUG-010: one recorder shared by the ws liquidation collectors, so the heartbeat is a
        // single timer rather than one per venue.
        UptimeRecorder,
        // IB-011: the operator's instrument. It lives behind the same switch because it watches
        // the collectors' streams.
        TelegramSender, WatchdogService,
      ],
    };
  }
}

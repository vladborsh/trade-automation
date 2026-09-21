import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/config.service';
import { ObservabilityModule } from '../observability/observability.module';
import { CANDLE_STORE } from './candle-store.port';
import { SIGNAL_STORE } from './signal-store.port';
import { METRIC_STORE } from './metric-store.port';
import { EVENT_STORE } from './event-store.port';
import { SCREENSHOT_STORE } from './screenshot-store.port';
import { FileCandleStore } from './file/file-candle-store';
import { FileSignalStore } from './file/file-signal-store';
import { FileMetricStore } from './file/file-metric-store';
import { FileEventStore } from './file/file-event-store';
import { FileScreenshotStore } from './file/file-screenshot-store';
import { S3CandleStore } from './s3/s3-candle-store';
import { S3SignalStore } from './s3/s3-signal-store';
import { S3MetricStore } from './s3/s3-metric-store';
import { S3EventStore } from './s3/s3-event-store';
import { S3ScreenshotStore } from './s3/s3-screenshot-store';
import { WriteBuffer } from './write-buffer.service';
import { NoPersistCandleStore, NoPersistEventStore, NoPersistMetricStore, NoPersistSignalStore, isReplayMode } from './replay-no-persist';
import { MetricWriteBuffer } from './metric-write-buffer.service';

/**
 * architecture/economic-calendar.md §4.3 — "SE should extract the repeated S3Client
 * construction in storage.module.ts into one helper while adding the fourth copy."
 */
function buildS3Client(config: AppConfigService): S3Client {
  return new S3Client({
    region: config.env.get('S3_REGION'),
    endpoint: config.env.get('S3_ENDPOINT') || undefined,
    forcePathStyle: Boolean(config.env.get('S3_ENDPOINT')),
  });
}

function requireBucket(config: AppConfigService): string {
  const bucket = config.env.get('S3_BUCKET');
  if (!bucket) throw new Error('S3_BUCKET is required when CANDLE_STORE=s3');
  return bucket;
}

/**
 * architecture/live-signal-server.md §4.3, §6.3 — CandleStore/SignalStore/MetricStore/EventStore
 * selected by config (`CANDLE_STORE=file|s3`); §6 recommends S3 as the production system of
 * record, but the choice is behind the port so DevOps' pin does not touch server code outside
 * this module. architecture/economic-calendar.md §4.2 adds the fourth store type (EventStore).
 */
@Module({
  imports: [AppConfigModule, ObservabilityModule],
  providers: [
    {
      provide: CANDLE_STORE,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const mode = config.env.get('CANDLE_STORE');
        const store = mode === 's3' ? new S3CandleStore(buildS3Client(config), requireBucket(config)) : new FileCandleStore(config.env.get('FILE_STORE_ROOT'));
        // BUG-006: in replay mode the candle, metric, signal and event stores drop writes and read
        // through (replay-no-persist.ts lists the accepted consequences). ScreenshotStore is not wrapped.
        return isReplayMode(config.env.get('MARKET_DATA_MODE')) ? new NoPersistCandleStore(store) : store;
      },
    },
    {
      provide: SIGNAL_STORE,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const mode = config.env.get('CANDLE_STORE');
        const store = mode === 's3' ? new S3SignalStore(buildS3Client(config), requireBucket(config)) : new FileSignalStore(config.env.get('FILE_STORE_ROOT'));
        return isReplayMode(config.env.get('MARKET_DATA_MODE')) ? new NoPersistSignalStore(store) : store;
      },
    },
    {
      provide: METRIC_STORE,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const mode = config.env.get('CANDLE_STORE');
        const store = mode === 's3' ? new S3MetricStore(buildS3Client(config), requireBucket(config)) : new FileMetricStore(config.env.get('FILE_STORE_ROOT'));
        return isReplayMode(config.env.get('MARKET_DATA_MODE')) ? new NoPersistMetricStore(store) : store;
      },
    },
    {
      provide: EVENT_STORE,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const mode = config.env.get('CANDLE_STORE');
        const store = mode === 's3' ? new S3EventStore(buildS3Client(config), requireBucket(config)) : new FileEventStore(config.env.get('FILE_STORE_ROOT'));
        return isReplayMode(config.env.get('MARKET_DATA_MODE')) ? new NoPersistEventStore(store) : store;
      },
    },
    {
      // backtest-app-system-design.md §2.2, D8: SCREENSHOT_STORE defaults to CANDLE_STORE's mode.
      provide: SCREENSHOT_STORE,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const mode = config.env.get('SCREENSHOT_STORE') ?? config.env.get('CANDLE_STORE');
        if (mode === 's3') return new S3ScreenshotStore(buildS3Client(config), requireBucket(config));
        return new FileScreenshotStore(config.env.get('FILE_STORE_ROOT'));
      },
    },
    WriteBuffer,
    MetricWriteBuffer,
  ],
  exports: [CANDLE_STORE, SIGNAL_STORE, METRIC_STORE, EVENT_STORE, SCREENSHOT_STORE, WriteBuffer, MetricWriteBuffer],
})
export class StorageModule implements OnModuleInit {
  private readonly logger = new Logger(StorageModule.name);

  constructor(private readonly config: AppConfigService) {}

  onModuleInit(): void {
    if (isReplayMode(this.config.env.get('MARKET_DATA_MODE'))) {
      this.logger.log('replay mode: stores are read-only (candles, metrics, signals, calendar events are never persisted; BUG-006)');
    }
  }
}

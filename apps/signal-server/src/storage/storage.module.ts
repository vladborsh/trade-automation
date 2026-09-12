import { Module } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/config.service';
import { ObservabilityModule } from '../observability/observability.module';
import { CANDLE_STORE } from './candle-store.port';
import { SIGNAL_STORE } from './signal-store.port';
import { METRIC_STORE } from './metric-store.port';
import { FileCandleStore } from './file/file-candle-store';
import { FileSignalStore } from './file/file-signal-store';
import { FileMetricStore } from './file/file-metric-store';
import { S3CandleStore } from './s3/s3-candle-store';
import { S3SignalStore } from './s3/s3-signal-store';
import { S3MetricStore } from './s3/s3-metric-store';
import { WriteBuffer } from './write-buffer.service';
import { MetricWriteBuffer } from './metric-write-buffer.service';

/**
 * architecture/live-signal-server.md §4.3, §6.3 — CandleStore/SignalStore selected by config
 * (`CANDLE_STORE=file|s3`); §6 recommends S3 as the production system of record, but the
 * choice is behind the port so DevOps' pin does not touch server code outside this module.
 */
@Module({
  imports: [AppConfigModule, ObservabilityModule],
  providers: [
    {
      provide: CANDLE_STORE,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const mode = config.env.get('CANDLE_STORE');
        if (mode === 's3') {
          const bucket = config.env.get('S3_BUCKET');
          if (!bucket) throw new Error('S3_BUCKET is required when CANDLE_STORE=s3');
          const client = new S3Client({
            region: config.env.get('S3_REGION'),
            endpoint: config.env.get('S3_ENDPOINT') || undefined,
            forcePathStyle: Boolean(config.env.get('S3_ENDPOINT')),
          });
          return new S3CandleStore(client, bucket);
        }
        return new FileCandleStore(config.env.get('FILE_STORE_ROOT'));
      },
    },
    {
      provide: SIGNAL_STORE,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const mode = config.env.get('CANDLE_STORE');
        if (mode === 's3') {
          const bucket = config.env.get('S3_BUCKET');
          if (!bucket) throw new Error('S3_BUCKET is required when CANDLE_STORE=s3');
          const client = new S3Client({
            region: config.env.get('S3_REGION'),
            endpoint: config.env.get('S3_ENDPOINT') || undefined,
            forcePathStyle: Boolean(config.env.get('S3_ENDPOINT')),
          });
          return new S3SignalStore(client, bucket);
        }
        return new FileSignalStore(config.env.get('FILE_STORE_ROOT'));
      },
    },
    {
      provide: METRIC_STORE,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const mode = config.env.get('CANDLE_STORE');
        if (mode === 's3') {
          const bucket = config.env.get('S3_BUCKET');
          if (!bucket) throw new Error('S3_BUCKET is required when CANDLE_STORE=s3');
          const client = new S3Client({
            region: config.env.get('S3_REGION'),
            endpoint: config.env.get('S3_ENDPOINT') || undefined,
            forcePathStyle: Boolean(config.env.get('S3_ENDPOINT')),
          });
          return new S3MetricStore(client, bucket);
        }
        return new FileMetricStore(config.env.get('FILE_STORE_ROOT'));
      },
    },
    WriteBuffer,
    MetricWriteBuffer,
  ],
  exports: [CANDLE_STORE, SIGNAL_STORE, METRIC_STORE, WriteBuffer, MetricWriteBuffer],
})
export class StorageModule {}

import { REPLAY_ROOT, restoreReplayBootEnv } from './replay-boot-env'; // first: env before config.module loads
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import { Candle, EconomicEvent, MetricObservation, Signal } from '@trade-automation/contracts';
import { AppModule } from '../../src/app.module';
import { IngestionService } from '../../src/market-data/ingestion.service';
import { CandleCache } from '../../src/market-data/candle-cache.service';
import { MetricIngestionService } from '../../src/market-data/metrics/metric-ingestion.service';
import { FileCandleStore } from '../../src/storage/file/file-candle-store';
import { FileEventStore } from '../../src/storage/file/file-event-store';
import { FileMetricStore } from '../../src/storage/file/file-metric-store';
import { FileSignalStore } from '../../src/storage/file/file-signal-store';

/**
 * BUG-006 done-line: booting the whole server in replay mode (the default) against a
 * FILE_STORE_ROOT that already holds data (in all four data stores, including the fixtures' own
 * day) leaves every existing file byte-identical and creates no file at all, while the replay
 * itself still runs (its candles reach the in-memory cache).
 */
function snapshot(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else out.set(path.relative(root, full), createHash('sha256').update(fs.readFileSync(full)).digest('hex'));
    }
  };
  walk(root);
  return out;
}

/** The first replay fixture candle, to seed "real" data on the very day the fixtures replay. */
const FIXTURE_FIRST: Candle = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/binance/BTCUSDT/1m.jsonl'), 'utf8').split('\n')[0]);
const DAY = Math.floor(FIXTURE_FIRST.openTime / 86_400_000) * 86_400_000;

async function seed(): Promise<void> {
  const real = (openTime: number, close: number): Candle => ({
    instrument: 'binance:BTCUSDT',
    timeframe: '1m',
    openTime,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1,
    closed: true,
    source: 'venue-rest',
  });
  // real candles on the fixtures' day and the day before
  await new FileCandleStore(REPLAY_ROOT).upsert([real(DAY - 60_000, 1), real(DAY + 60_000, 2), real(FIXTURE_FIRST.openTime, 3)]);
  const oi: MetricObservation = { metric: 'openInterest', instrument: 'binance:BTCUSDT', time: FIXTURE_FIRST.openTime, value: 123, unit: 'base' };
  await new FileMetricStore(REPLAY_ROOT).upsert([oi]);
  const signal = { id: 'real-signal', strategyId: 'example-cross', instrument: 'binance:BTCUSDT', time: FIXTURE_FIRST.openTime, side: 'long' } as unknown as Signal;
  await new FileSignalStore(REPLAY_ROOT).append([signal]);
  const event = {
    id: 'real-event',
    title: 'Real event',
    country: 'USD',
    impact: 'high',
    scheduledAt: DAY + 3_600_000,
    status: 'scheduled',
  } as unknown as EconomicEvent;
  await new FileEventStore(REPLAY_ROOT).upsert([event]);
}

describe('BUG-006: replay mode never writes under FILE_STORE_ROOT', () => {
  let app: INestApplication;

  afterAll(async () => {
    await app?.close();
    restoreReplayBootEnv();
  });

  it('existing files stay byte-identical and no new file appears, while the replay runs', async () => {
    await seed();
    const beforeBoot = snapshot(REPLAY_ROOT);
    expect([...new Set([...beforeBoot.keys()].map((k) => k.split(path.sep)[0]))].sort()).toEqual(['calendar', 'candles', 'metrics', 'signals']);

    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication({ logger: false });
    app.useWebSocketAdapter(new WsAdapter(app)); // as main.ts does
    await app.init();
    // what main.ts starts after listen(): the deep backfills (the bug's other writer path)
    void app.get(IngestionService).deepenHistoryAsync();
    void app.get(MetricIngestionService).deepenHistoryAsync();

    // the replay did run: its candles reach the in-memory cache the live endpoints read
    const cache = app.get(CandleCache);
    const deadline = Date.now() + 15_000;
    while (!cache.window('binance:BTCUSDT', '1m').some((c) => c.openTime === FIXTURE_FIRST.openTime + 60_000) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(cache.window('binance:BTCUSDT', '1m').some((c) => c.openTime === FIXTURE_FIRST.openTime + 60_000)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1500)); // let the calendar, signals and backfills settle
    await app.close(); // WriteBuffer / MetricWriteBuffer flush on shutdown
    app = undefined as never;

    const afterBoot = snapshot(REPLAY_ROOT);
    expect([...afterBoot.keys()].sort()).toEqual([...beforeBoot.keys()].sort()); // no new files
    for (const [file, hash] of beforeBoot) expect([file, afterBoot.get(file)]).toEqual([file, hash]); // byte-identical
  }, 60_000);
});

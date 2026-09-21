import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Test } from '@nestjs/testing';
import { Candle, EconomicEvent, MetricObservation, Signal } from '@trade-automation/contracts';
import { AppConfigService } from '../../src/config/config.service';
import { CANDLE_STORE, CandleStore } from '../../src/storage/candle-store.port';
import { EVENT_STORE, EventStore } from '../../src/storage/event-store.port';
import { FileCandleStore } from '../../src/storage/file/file-candle-store';
import { FileEventStore } from '../../src/storage/file/file-event-store';
import { FileMetricStore } from '../../src/storage/file/file-metric-store';
import { FileSignalStore } from '../../src/storage/file/file-signal-store';
import { METRIC_STORE, MetricStore } from '../../src/storage/metric-store.port';
import {
  NoPersistCandleStore,
  NoPersistEventStore,
  NoPersistMetricStore,
  NoPersistSignalStore,
} from '../../src/storage/replay-no-persist';
import { SCREENSHOT_STORE } from '../../src/storage/screenshot-store.port';
import { SIGNAL_STORE, SignalStore } from '../../src/storage/signal-store.port';
import { StorageModule } from '../../src/storage/storage.module';

const candle: Candle = {
  instrument: 'binance:BTCUSDT', timeframe: '1m', openTime: Date.UTC(2026, 8, 12), open: 1, high: 2, low: 0.5, close: 1.5, volume: 3, closed: true, source: 'venue-stream',
};
const oi: MetricObservation = { metric: 'openInterest', instrument: 'binance:BTCUSDT', time: Date.UTC(2026, 8, 12), value: 1, unit: 'base' };
const signal = { id: 's', strategyId: 'x', instrument: 'binance:BTCUSDT', time: Date.UTC(2026, 8, 12), side: 'long' } as unknown as Signal;
const event = { id: 'e', title: 'E', country: 'USD', impact: 'high', scheduledAt: Date.UTC(2026, 8, 12), status: 'scheduled' } as unknown as EconomicEvent;

function files(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) (e.isDirectory() ? walk : (f: string) => out.push(path.relative(root, f)))(path.join(dir, e.name));
  };
  walk(root);
  return out.sort();
}

/** StorageModule's real factories, with the env replaced (ConfigModule reads process.env only once). */
async function storesFor(mode: 'live' | 'replay', root: string) {
  const env: Record<string, unknown> = { MARKET_DATA_MODE: mode, CANDLE_STORE: 'file', FILE_STORE_ROOT: root, LOG_LEVEL: 'error', NODE_ENV: 'test' };
  const moduleRef = await Test.createTestingModule({ imports: [StorageModule] })
    .overrideProvider(AppConfigService)
    .useValue({ env: { get: (k: string) => env[k] }, instruments: [] })
    .compile();
  return {
    candles: moduleRef.get<CandleStore>(CANDLE_STORE),
    metrics: moduleRef.get<MetricStore>(METRIC_STORE),
    signals: moduleRef.get<SignalStore>(SIGNAL_STORE),
    events: moduleRef.get<EventStore>(EVENT_STORE),
    screenshots: moduleRef.get(SCREENSHOT_STORE),
    close: () => moduleRef.close(),
  };
}

describe('StorageModule wiring by MARKET_DATA_MODE (BUG-006)', () => {
  let root: string;
  beforeEach(() => (root = fs.mkdtempSync(path.join(os.tmpdir(), 'no-persist-wiring-'))));
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('live mode: the plain stores, and every write reaches FILE_STORE_ROOT', async () => {
    const s = await storesFor('live', root);
    expect(s.candles).toBeInstanceOf(FileCandleStore);
    expect(s.metrics).toBeInstanceOf(FileMetricStore);
    expect(s.signals).toBeInstanceOf(FileSignalStore);
    expect(s.events).toBeInstanceOf(FileEventStore);
    await s.candles.upsert([candle]);
    await s.metrics.upsert([oi]);
    await s.signals.append([signal]);
    await s.events.upsert([event]);
    expect(new Set(files(root).map((f) => f.split(path.sep)[0]))).toEqual(new Set(['candles', 'metrics', 'signals', 'calendar']));
    await expect(s.candles.query('binance:BTCUSDT', '1m', 0, Date.UTC(2027, 0))).resolves.toEqual([candle]);
    await s.close();
  });

  it('replay mode: the four data stores drop writes (nothing on disk) and still read the real files', async () => {
    await new FileCandleStore(root).upsert([candle]); // "real" data already there
    const before = files(root);
    const s = await storesFor('replay', root);
    expect(s.candles).toBeInstanceOf(NoPersistCandleStore);
    expect(s.metrics).toBeInstanceOf(NoPersistMetricStore);
    expect(s.signals).toBeInstanceOf(NoPersistSignalStore);
    expect(s.events).toBeInstanceOf(NoPersistEventStore);
    await s.candles.upsert([{ ...candle, openTime: candle.openTime + 60_000 }]);
    await s.metrics.upsert([oi]);
    await s.signals.append([signal]);
    await s.events.upsert([event]);
    await s.events.appendRevisions([{ eventId: 'e' } as never]);
    await s.events.appendNotifications([{ id: 'n', firedAt: Date.UTC(2026, 8, 12) } as never]);
    expect(files(root)).toEqual(before);
    await expect(s.candles.query('binance:BTCUSDT', '1m', 0, Date.UTC(2027, 0))).resolves.toEqual([candle]); // reads pass through
    await expect(s.candles.coverage('binance:BTCUSDT', '1m')).resolves.toEqual({ from: candle.openTime, to: candle.openTime });
    await s.close();
  });

  it('the ScreenshotStore is never wrapped (user uploads, not reached by replay)', async () => {
    const s = await storesFor('replay', root);
    expect(s.screenshots.constructor.name).toBe('FileScreenshotStore');
    await s.close();
  });
});

describe('NoPersist* wrappers', () => {
  it('drop every write and delegate every read, arguments untouched', async () => {
    const inner = {
      upsert: jest.fn(), query: jest.fn().mockResolvedValue(['q']), latestOpenTime: jest.fn().mockResolvedValue(7), stream: jest.fn().mockReturnValue('it'), coverage: jest.fn().mockResolvedValue({ from: 1, to: 2 }),
    };
    const c = new NoPersistCandleStore(inner as never);
    await c.upsert([candle]);
    expect(inner.upsert).not.toHaveBeenCalled();
    await expect(c.query('binance:BTCUSDT', '1h', 1, 2)).resolves.toEqual(['q']);
    expect(inner.query).toHaveBeenCalledWith('binance:BTCUSDT', '1h', 1, 2);
    await expect(c.latestOpenTime('binance:BTCUSDT', '1m')).resolves.toBe(7);
    expect(c.stream('binance:BTCUSDT', '1m', 1, 2)).toBe('it');
    await expect(c.coverage('binance:BTCUSDT', '1m')).resolves.toEqual({ from: 1, to: 2 });

    const ev = { upsert: jest.fn(), appendRevisions: jest.fn(), appendNotifications: jest.fn(), queryByScheduled: jest.fn().mockResolvedValue([]), get: jest.fn().mockResolvedValue(null), queryRevisions: jest.fn().mockResolvedValue([]), queryNotifications: jest.fn().mockResolvedValue(['n']) };
    const e = new NoPersistEventStore(ev as never);
    await e.upsert([event]);
    await e.appendRevisions([]);
    await e.appendNotifications([]);
    expect([ev.upsert, ev.appendRevisions, ev.appendNotifications].every((m) => m.mock.calls.length === 0)).toBe(true);
    await expect(e.queryNotifications(1, 2)).resolves.toEqual(['n']);
    expect(ev.queryNotifications).toHaveBeenCalledWith(1, 2);
  });
});

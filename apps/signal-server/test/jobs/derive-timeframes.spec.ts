import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Candle, Timeframe } from '@trade-automation/contracts';
import { deriveTimeframes, parseDeriveArgs } from '../../src/jobs/derive-timeframes.job';
import { FileCandleStore } from '../../src/storage/file/file-candle-store';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const D1 = Date.UTC(2026, 0, 5); // Monday
const BTC = 'binance:BTCUSDT' as const;

/** 1m candle whose prices encode its minute index, so derived OHLCV are checkable by hand. */
function oneMinute(openTime: number): Candle {
  const i = (openTime - D1) / MIN;
  return {
    instrument: BTC, timeframe: '1m', openTime,
    open: 1000 + i, high: 1000 + i + 0.5, low: 1000 + i - 0.5, close: 1000 + i + 0.25,
    volume: 1, closed: true, source: 'venue-rest',
  };
}

function minutes(from: number, count: number): Candle[] {
  return Array.from({ length: count }, (_, k) => oneMinute(from + k * MIN));
}

describe('deriveTimeframes (architecture/backtest-app-system-design.md §10)', () => {
  let root: string;
  let store: FileCandleStore;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'derive-timeframes-'));
    store = new FileCandleStore(root);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const all = (tf: Timeframe) => store.query(BTC, tf, 0, D1 + 10 * DAY);

  describe('two full days plus a partial third day (tail ends 10:37)', () => {
    beforeEach(async () => {
      await store.upsert(minutes(D1, 2 * 1440 + 10 * 60 + 38)); // up to and including D3 10:37
    });

    it('writes every closed bar of the full days, with source resampled', async () => {
      const counts = await deriveTimeframes(store, BTC, { force: false });

      expect(counts).toMatchObject({ days1m: 3, candles1m: 2 * 1440 + 638 });
      const oneDay = await all('1d');
      expect(oneDay.map((c) => c.openTime)).toEqual([D1, D1 + DAY]);
      expect(oneDay.every((c) => c.source === 'resampled' && c.closed)).toBe(true);

      // 1h at D1 00:00 folds minutes 0..59: open of 0, high of 59, low of 0, close of 59, volume 60.
      const [firstHour] = await store.query(BTC, '1h', D1, D1);
      expect(firstHour).toMatchObject({ open: 1000, high: 1059.5, low: 999.5, close: 1059.25, volume: 60 });
    });

    it('never emits a closed bar from the partial tail', async () => {
      await deriveTimeframes(store, BTC, { force: false });
      const d3 = D1 + 2 * DAY;
      const last = async (tf: Timeframe) => (await all(tf)).at(-1)!.openTime;

      // D3 at 10:37: the 1d, 4h 08:00, 1h 10:00, 15m 10:30 and 5m 10:35 bars are still forming.
      expect(await last('1d')).toBe(D1 + DAY);
      expect(await last('4h')).toBe(d3 + 4 * 60 * MIN);
      expect(await last('1h')).toBe(d3 + 9 * 60 * MIN);
      expect(await last('15m')).toBe(d3 + (10 * 60 + 15) * MIN);
      expect(await last('5m')).toBe(d3 + (10 * 60 + 30) * MIN);
      expect((await all('5m')).length).toBe(2 * 288 + 127);
    });

    it('running twice is a no-op: the second run writes nothing', async () => {
      await deriveTimeframes(store, BTC, { force: false });
      const before = await Promise.all(['5m', '15m', '1h', '4h', '1d'].map((tf) => all(tf as Timeframe)));
      const upsert = jest.spyOn(store, 'upsert');

      const second = await deriveTimeframes(store, BTC, { force: false });

      expect(upsert).not.toHaveBeenCalled();
      expect(second!.written).toEqual({});
      expect(second!.skipped).toEqual({ '5m': 2 * 288 + 127, '15m': 2 * 96 + 42, '1h': 58, '4h': 14, '1d': 2 });
      const after = await Promise.all(['5m', '15m', '1h', '4h', '1d'].map((tf) => all(tf as Timeframe)));
      expect(after).toEqual(before);
    });
  });

  it('keeps a live/venue bar: a day with a venue 5m bar at 10:00 keeps it, the gaps around it are filled', async () => {
    await store.upsert(minutes(D1, 1441)); // D1 plus its closing minute
    const venue5m: Candle = {
      ...oneMinute(D1 + 600 * MIN), timeframe: '5m', open: 1, high: 2, low: 0.5, close: 1.5, volume: 7, source: 'venue-stream',
    };
    await store.upsert([venue5m]);

    const counts = await deriveTimeframes(store, BTC, { force: false });
    const again = await deriveTimeframes(store, BTC, { force: true });

    const d1FiveMin = await store.query(BTC, '5m', D1, D1 + DAY - 1);
    expect(d1FiveMin).toHaveLength(288);
    expect(d1FiveMin.find((c) => c.openTime === venue5m.openTime)).toEqual(venue5m);
    expect(counts!.written['5m']).toBe(287);
    expect(counts!.skipped['5m']).toBe(1);
    // --force rewrites only what this job wrote; the venue bar is still skipped.
    expect(again!.replaced['5m']).toBe(287);
    expect(again!.skipped['5m']).toBe(1);
    expect(again!.written).toEqual({});
  });

  it('floors --from to its UTC day, so the first derived bars see every minute', async () => {
    await store.upsert(minutes(D1, 2 * 1440 + 1));

    await deriveTimeframes(store, BTC, { force: false, fromMs: D1 + DAY + 637 * MIN });

    expect((await all('1d')).map((c) => c.openTime)).toEqual([D1 + DAY]);
    const [d2first] = await store.query(BTC, '1h', D1 + DAY, D1 + DAY);
    expect(d2first).toMatchObject({ open: 1000 + 1440, volume: 60 });
    expect(await store.query(BTC, '5m', D1, D1 + DAY - 1)).toEqual([]);
  });

  it('returns null for an instrument with no 1m', async () => {
    expect(await deriveTimeframes(store, 'binance:ETHUSDT', { force: false })).toBeNull();
  });
});

describe('parseDeriveArgs', () => {
  it('parses --instrument, --from and --force', () => {
    expect(parseDeriveArgs(['--instrument', 'binance:BTCUSDT', '--from', '2024-01-02', '--force'])).toEqual({
      instrument: 'binance:BTCUSDT', fromMs: Date.UTC(2024, 0, 2), force: true,
    });
    expect(parseDeriveArgs([])).toEqual({ force: false });
  });

  it('rejects unknown flags, missing values and bad dates', () => {
    expect(() => parseDeriveArgs(['--nope'])).toThrow(/unknown/);
    expect(() => parseDeriveArgs(['--from'])).toThrow(/value/);
    expect(() => parseDeriveArgs(['--from', 'yesterday'])).toThrow(/ISO/);
  });
});

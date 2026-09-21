import { Logger } from '@nestjs/common';
import { foldOneMinute } from '@trade-automation/replay-core';
import { ReplayHistoryService } from '../../src/backtest/replay-history.service';
import { FileCandleStore } from '../../src/storage/file/file-candle-store';
import { DAY, H, INSTRUMENT, MIN, oneMinuteRange, persistedBar, tempStore } from './replay-fixtures';

const T0 = Date.UTC(2021, 5, 1); // a Tuesday

describe('ReplayHistoryService (backtest-app-system-design.md §5.1, §7.2)', () => {
  let store: FileCandleStore;
  let cleanup: () => void;
  let service: ReplayHistoryService;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    ({ store, cleanup } = tempStore());
    service = new ReplayHistoryService(store);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
    cleanup();
  });

  describe('forming bar', () => {
    beforeEach(() => store.upsert(oneMinuteRange(T0, T0 + 6 * H)));

    it('at a mid-bar cursor: foldOneMinute over the 1m in [floor(before/tfMs)*tfMs, before), bit for bit', async () => {
      const before = T0 + 2 * H + 37 * MIN;
      const { forming } = await service.history(INSTRUMENT, '1h', before, 10);
      const bucket1m = oneMinuteRange(T0 + 2 * H, before);
      expect(forming).toEqual(foldOneMinute(bucket1m, '1h', before).forming);
      expect(forming).toMatchObject({ openTime: T0 + 2 * H, closed: false });
      expect(forming!.open).toBe(bucket1m[0].open);
      expect(forming!.close).toBe(bucket1m[bucket1m.length - 1].close);
      expect(forming!.volume).toBe(bucket1m.reduce((s, c) => s + c.volume, 0));
    });

    it('is exactly what the client gets folding the whole revealed 1m run up to the cursor (§5.4)', async () => {
      const before = T0 + 4 * H + 13 * MIN;
      const { forming } = await service.history(INSTRUMENT, '15m', before, 10);
      expect(forming).toEqual(foldOneMinute(oneMinuteRange(T0, T0 + 6 * H), '15m', before).forming);
    });

    it('is absent on a boundary, and always for 1m', async () => {
      expect((await service.history(INSTRUMENT, '1h', T0 + 3 * H, 10)).forming).toBeNull();
      expect((await service.history(INSTRUMENT, '1m', T0 + 3 * H + 30 * MIN, 10)).forming).toBeNull();
    });

    it('is null when no 1m has arrived yet in the cursor bucket', async () => {
      expect((await service.history(INSTRUMENT, '1h', T0 + 8 * H + 5 * MIN, 10)).forming).toBeNull();
    });
  });

  describe('closed bars', () => {
    it('reads the persisted tf, venue and resampled bars mixed, without folding', async () => {
      await store.upsert(oneMinuteRange(T0, T0 + 6 * H));
      await store.upsert([0, 1, 2].map((i) => persistedBar('1h', T0 + i * H, 'venue-rest')));
      await store.upsert([3, 4, 5].map((i) => persistedBar('1h', T0 + i * H, 'resampled')));

      const { bars } = await service.history(INSTRUMENT, '1h', T0 + 6 * H, 10);
      expect(bars.map((b) => [b.openTime, b.source])).toEqual([
        [T0, 'venue-rest'],
        [T0 + H, 'venue-rest'],
        [T0 + 2 * H, 'venue-rest'],
        [T0 + 3 * H, 'resampled'],
        [T0 + 4 * H, 'resampled'],
        [T0 + 5 * H, 'resampled'],
      ]);
      expect(bars.every((b) => b.volume === 7)).toBe(true); // persisted, not folded
      expect(warn).not.toHaveBeenCalled();
    });

    it('only closed bars: openTime + tfMs <= before, the last `limit` of them', async () => {
      await store.upsert([0, 1, 2, 3, 4, 5].map((i) => persistedBar('1h', T0 + i * H, 'resampled')));
      const mid = await service.history(INSTRUMENT, '1h', T0 + 4 * H + 30 * MIN, 2);
      expect(mid.bars.map((b) => b.openTime)).toEqual([T0 + 2 * H, T0 + 3 * H]);
      const edge = await service.history(INSTRUMENT, '1h', T0 + 4 * H, 10);
      expect(edge.bars.map((b) => b.openTime).at(-1)).toBe(T0 + 3 * H);
    });

    it('falls back to folding from 1m when the tf has nothing persisted, and warns', async () => {
      const tape = oneMinuteRange(T0, T0 + 5 * H);
      await store.upsert(tape);
      const { bars } = await service.history(INSTRUMENT, '1h', T0 + 4 * H + 20 * MIN, 100);
      expect(bars).toEqual(foldOneMinute(tape, '1h', T0 + 4 * H).closed);
      expect(bars).toHaveLength(4);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/binance:BTCUSDT 1h: 1 range\(s\) within .* had no persisted bars .* derive-timeframes/);
    });

    it('folds only the tail the derive job has not reached; the rest comes from the store', async () => {
      await store.upsert(oneMinuteRange(T0, T0 + 6 * H));
      await store.upsert([0, 1, 2].map((i) => persistedBar('1h', T0 + i * H, 'resampled')));
      const { bars } = await service.history(INSTRUMENT, '1h', T0 + 6 * H, 10);
      expect(bars.map((b) => [b.openTime, b.volume === 7 ? 'store' : 'fold'])).toEqual([
        [T0, 'store'],
        [T0 + H, 'store'],
        [T0 + 2 * H, 'store'],
        [T0 + 3 * H, 'fold'],
        [T0 + 4 * H, 'fold'],
        [T0 + 5 * H, 'fold'],
      ]);
      expect(bars.slice(3)).toEqual(foldOneMinute(oneMinuteRange(T0 + 3 * H, T0 + 6 * H), '1h', T0 + 6 * H).closed);
    });

    describe('holes inside the persisted span (T-014 review r1)', () => {
      // persisted 1h on days 0-1 and 5-6; days 2-4 are a 3-day hole in the persisted tf
      const persistedDays = [0, 1, 5, 6];
      const writePersisted = () =>
        store.upsert(persistedDays.flatMap((d) => Array.from({ length: 24 }, (_, h) => persistedBar('1h', T0 + d * DAY + h * H, 'resampled'))));

      it('a hole where 1m exists is folded from 1m and warn-logged', async () => {
        await writePersisted();
        const hole1m = oneMinuteRange(T0 + 2 * DAY, T0 + 5 * DAY);
        await store.upsert(hole1m);
        const { bars } = await service.history(INSTRUMENT, '1h', T0 + 7 * DAY, 24 * 7);
        expect(bars).toHaveLength(24 * 7);
        expect(bars.map((b) => b.openTime)).toEqual(Array.from({ length: 24 * 7 }, (_, i) => T0 + i * H)); // contiguous
        const inHole = bars.filter((b) => b.openTime >= T0 + 2 * DAY && b.openTime < T0 + 5 * DAY);
        expect(inHole).toEqual(foldOneMinute(hole1m, '1h', T0 + 5 * DAY).closed);
        expect(bars.filter((b) => b.volume === 7)).toHaveLength(24 * 4); // the persisted days, untouched
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toMatch(/1 range\(s\) within \[2021-06-03T00:00:00.000Z, 2021-06-06T00:00:00.000Z\)/);
      });

      it('the same hole with no 1m stays a gap, with no fold', async () => {
        await writePersisted();
        // 1m exists outside the hole only, so the 1m coverage spans it
        await store.upsert([...oneMinuteRange(T0, T0 + 2 * DAY), ...oneMinuteRange(T0 + 5 * DAY, T0 + 7 * DAY)]);
        const { bars } = await service.history(INSTRUMENT, '1h', T0 + 7 * DAY, 24 * 7);
        expect(bars).toHaveLength(24 * 4);
        expect(bars.every((b) => b.volume === 7)).toBe(true);
        expect(bars.some((b) => b.openTime >= T0 + 2 * DAY && b.openTime < T0 + 5 * DAY)).toBe(false);
        expect(warn).not.toHaveBeenCalled();
      });

      it('a weekend on a Capital.com-like tape costs no fold', async () => {
        // weekdays only: Fri 2021-06-04 and Mon 2021-06-07, 1m and derived 1h both; nothing Sat/Sun
        const fri = Date.UTC(2021, 5, 4);
        const mon = Date.UTC(2021, 5, 7);
        const ndx = 'capitalcom:US100' as const;
        const weekday1m = [...oneMinuteRange(fri, fri + DAY, ndx), ...oneMinuteRange(mon, mon + DAY, ndx)];
        await store.upsert(weekday1m);
        const derived = [...foldOneMinute(oneMinuteRange(fri, fri + DAY, ndx), '1h', fri + DAY).closed, ...foldOneMinute(oneMinuteRange(mon, mon + DAY, ndx), '1h', mon + DAY).closed];
        await store.upsert(derived);
        const query1m = jest.spyOn(store, 'query');

        const { bars } = await service.history(ndx, '1h', mon + DAY, 48);
        expect(bars).toEqual(derived);
        expect(warn).not.toHaveBeenCalled();
        // the only 1m reads are the weekend hole's existence checks (split across the two
        // backward windows), each finding nothing
        const oneMinuteReads = query1m.mock.calls.filter((c) => c[1] === '1m');
        expect(oneMinuteReads.length).toBeGreaterThan(0);
        for (const [, , from, to] of oneMinuteReads) {
          expect(from).toBeGreaterThanOrEqual(fri + DAY);
          expect(to).toBeLessThan(mon);
        }
        for (const r of query1m.mock.results.filter((_, i) => query1m.mock.calls[i][1] === '1m')) {
          await expect(r.value).resolves.toEqual([]);
        }
      });
    });

    it('walks back across a gap in the tape to fill `limit`', async () => {
      // two days of 1m, then a 9-day hole, then two more days
      await store.upsert(oneMinuteRange(T0, T0 + 2 * DAY));
      await store.upsert(oneMinuteRange(T0 + 11 * DAY, T0 + 13 * DAY));
      const { bars } = await service.history(INSTRUMENT, '1d', T0 + 13 * DAY, 4);
      expect(bars.map((b) => (b.openTime - T0) / DAY)).toEqual([0, 1, 11, 12]);
    });

    it('returns what exists when the store holds fewer than `limit` bars, and [] for an empty store', async () => {
      await store.upsert(oneMinuteRange(T0, T0 + 3 * H));
      expect((await service.history(INSTRUMENT, '1h', T0 + 3 * H, 1500)).bars).toHaveLength(3);
      expect(await service.history('binance:ETHUSDT', '1h', T0 + 3 * H, 10)).toEqual({ bars: [], forming: null });
    });

    it('1m: revealed candles only (openTime + 60s <= before)', async () => {
      await store.upsert(oneMinuteRange(T0, T0 + H));
      const { bars } = await service.history(INSTRUMENT, '1m', T0 + 10 * MIN + 30_000, 3);
      expect(bars.map((b) => (b.openTime - T0) / MIN)).toEqual([7, 8, 9]);
      expect(warn).not.toHaveBeenCalled();
    });
  });
});

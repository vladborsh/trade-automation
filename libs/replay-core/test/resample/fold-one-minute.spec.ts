import { Candle } from '@trade-automation/contracts';
import { foldOneMinute } from '../../src/resample/fold-one-minute';

const MIN = 60_000;

function bar1m(openTime: number, o: number, h: number, l: number, c: number, v = 1): Candle {
  return {
    instrument: 'binance:BTCUSDT',
    timeframe: '1m',
    openTime,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: v,
    closed: true,
    source: 'venue-stream',
  };
}

describe('foldOneMinute (architecture/backtest-app-system-design.md §2.1, §5.1)', () => {
  const base = Date.UTC(2026, 0, 1, 0, 0, 0);

  it('closes a tf bar and reports no forming bar when upToMs lands exactly on a tf boundary', () => {
    const bars = [0, 1, 2, 3, 4].map((i) => bar1m(base + i * MIN, 100 + i, 105 + i, 95 + i, 101 + i));
    const { closed, forming } = foldOneMinute(bars, '5m', base + 5 * MIN);

    expect(forming).toBeNull();
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({
      timeframe: '5m',
      openTime: base,
      open: 100,
      close: 101 + 4,
      high: 105 + 4,
      low: 95,
      closed: true,
    });
  });

  it('produces a forming bar for a mid-bar cursor, without closing it', () => {
    const bars = [0, 1, 2].map((i) => bar1m(base + i * MIN, 100 + i, 105 + i, 95 + i, 101 + i));
    const { closed, forming } = foldOneMinute(bars, '5m', base + 3 * MIN);

    expect(closed).toHaveLength(0);
    expect(forming).toMatchObject({
      timeframe: '5m',
      openTime: base,
      open: 100,
      close: 101 + 2,
      high: 105 + 2,
      low: 95,
      closed: false,
    });
  });

  it('ignores 1m candles whose interval is not yet fully revealed at upToMs', () => {
    const bars = [0, 1].map((i) => bar1m(base + i * MIN, 100 + i, 105 + i, 95 + i, 101 + i));
    // upToMs sits inside minute index 1's interval (not yet closed at upToMs)
    const { forming } = foldOneMinute(bars, '5m', base + MIN + 30_000);

    expect(forming).toMatchObject({ openTime: base, close: 101 }); // only minute 0 folded in
  });

  it('returns no forming bar when nothing has arrived yet for the bucket containing the cursor', () => {
    // an empty stretch precedes upToMs: the last revealed 1m candle belongs to an earlier bucket,
    // which is complete by upToMs and therefore closed (BUG-001: it used to be dropped)
    const bars = [bar1m(base, 100, 105, 95, 101)];
    const { closed, forming } = foldOneMinute(bars, '5m', base + 20 * MIN);

    expect(forming).toBeNull();
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ timeframe: '5m', openTime: base, open: 100, close: 101, closed: true });
  });

  it('tf=1m: closed is exactly the fully-revealed 1m candles, forming is always null', () => {
    const bars = [0, 1, 2].map((i) => bar1m(base + i * MIN, 100 + i, 105 + i, 95 + i, 101 + i));
    const { closed, forming } = foldOneMinute(bars, '1m', base + 2 * MIN);

    expect(closed).toHaveLength(2);
    expect(forming).toBeNull();
  });

  describe('BUG-001: the last bar before a gap in the 1m run is closed, not dropped', () => {
    const H = 60 * MIN;
    const DAY = 24 * H;
    const run = (from: number, to: number) => {
      const out: Candle[] = [];
      for (let t = from; t < to; t += MIN) {
        const i = t / MIN;
        out.push(bar1m(t, 100 + (i % 7), 102 + (i % 5), 98 - (i % 3), 100 + (i % 11) * 0.1, 1 + (i % 4)));
      }
      return out;
    };

    it('the weekend repro: Fri 22:00-23:59 folded up to Mon 00:05 closes both 1h bars', () => {
      const fri22 = Date.UTC(2021, 5, 4, 22);
      const monday = Date.UTC(2021, 5, 7, 0, 5);
      const friday = run(fri22, fri22 + 2 * H);

      const { closed, forming } = foldOneMinute(friday, '1h', monday);

      expect(closed.map((c) => c.openTime)).toEqual([fri22, fri22 + H]);
      expect(closed.every((c) => c.closed)).toBe(true);
      expect(forming).toBeNull(); // nothing has arrived for Monday 00:00 yet
      // identical to folding the same run up to its own close (Sat 00:00), where it always worked
      expect(closed).toEqual(foldOneMinute(friday, '1h', fri22 + 2 * H).closed);
    });

    it.each([
      ['5m', 5 * MIN],
      ['1h', H],
      ['1d', DAY],
    ] as const)('a mid-session gap on %s: every bar before the gap is closed, the bar after it forms', (tf, tfMs) => {
      const start = Date.UTC(2021, 5, 1);
      const beforeGap = run(start, start + 3 * tfMs); // three complete bars
      const resume = start + 7 * tfMs; // three empty buckets, then the tape resumes
      const afterGap = run(resume, resume + tfMs / 2 + MIN); // half a bar
      const upTo = resume + tfMs / 2; // cursor mid-bar after the gap

      const { closed, forming } = foldOneMinute([...beforeGap, ...afterGap], tf, upTo);

      expect(closed.map((c) => (c.openTime - start) / tfMs)).toEqual([0, 1, 2]);
      expect(closed[2]).toEqual(foldOneMinute(beforeGap, tf, start + 3 * tfMs).closed[2]); // same bytes as a boundary fold
      expect(forming).toMatchObject({ openTime: resume, closed: false });
      // closes with the last 1m revealed at upTo (openTime + 60s <= upTo)
      const revealed = afterGap.filter((c) => c.openTime + MIN <= upTo);
      expect(revealed.length).toBeLessThan(afterGap.length);
      expect(forming!.close).toBe(revealed[revealed.length - 1].close);
    });

    it('stepping across the gap (the client folds each popped run, §5.4) loses nothing', () => {
      const start = Date.UTC(2021, 5, 4, 20);
      const tape = [...run(start, start + 4 * H), ...run(start + 58 * H, start + 62 * H)]; // Fri evening, then Mon
      const stepTo = [start + H, start + 3 * H, start + 58 * H + 5 * MIN, start + 60 * H, start + 62 * H];

      const stepped: Candle[] = [];
      let from = start;
      for (const upTo of stepTo) {
        const popped = tape.filter((c) => c.openTime >= from && c.openTime + MIN <= upTo);
        stepped.push(...foldOneMinute(popped, '1h', upTo).closed);
        from = upTo;
      }
      // the stateless per-step fold can split a bar across two steps; the client merges by
      // openTime (mergeLive), so compare the last version of each bar
      const byOpen = new Map(stepped.map((c) => [c.openTime, c]));
      const once = foldOneMinute(tape, '1h', start + 62 * H).closed;
      expect([...byOpen.keys()]).toEqual(once.map((c) => c.openTime));
      expect(once.map((c) => (c.openTime - start) / H)).toEqual([0, 1, 2, 3, 58, 59, 60, 61]);
    });
  });
});

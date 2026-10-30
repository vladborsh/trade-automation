import { vi } from 'vitest';
import type { PaneData } from './pane-data';
import {
  CANDLES_EVERY_MS, LiveTail, SIDE_EVERY_MS, candleTailFrom, dailyTailFrom, sideTailFrom, type TailJob,
  type Visibility,
} from './live-tail';

/** A `document` whose visibility the spec flips. */
function fakeDocument(): Visibility & { set(state: DocumentVisibilityState): void; listeners: number } {
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    set(state: DocumentVisibilityState) {
      doc.visibilityState = state;
      for (const l of [...listeners]) l();
    },
    get listeners() { return listeners.size; },
  };
  return doc;
}

/** A job that records each read's `since` and resolves when the spec says so (or at once). */
function job(every: number, opts: { manual?: boolean } = {}) {
  const reads: Array<{ since: number; now: number }> = [];
  const applied: number[] = [];
  const pending: Array<() => void> = [];
  const j: TailJob = {
    every,
    read: (since, now) => {
      reads.push({ since, now });
      const apply = () => applied.push(now);
      if (!opts.manual) return Promise.resolve(apply);
      return new Promise((resolve) => pending.push(() => resolve(apply)));
    },
  };
  return { job: j, reads, applied, release: () => pending.shift()?.() };
}

const T0 = Date.UTC(2026, 9, 29, 12, 0);
const WINDOW = 86_400_000;

function setup(over: { busy?: () => boolean; jobs?: TailJob[] } = {}) {
  const candles = job(CANDLES_EVERY_MS);
  const side = job(SIDE_EVERY_MS);
  const doc = fakeDocument();
  let generation = 1;
  const reload = vi.fn();
  const tail = new LiveTail({
    jobs: over.jobs ?? [candles.job, side.job],
    generation: () => generation,
    busy: over.busy ?? (() => false),
    maxGapMs: () => WINDOW,
    reload,
    visibility: doc,
    now: () => Date.now(),
  });
  return { tail, candles, side, doc, reload, bump: () => generation++ };
}

describe('LiveTail', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it('polls candles every 5 s and the rest every minute', async () => {
    const { tail, candles, side } = setup();
    tail.start();
    tail.reset(T0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(candles.reads).toHaveLength(12);
    expect(side.reads).toHaveLength(1);
    tail.stop();
  });

  it('each read starts where the previous applied one did; the first where the window ended', async () => {
    const { tail, candles } = setup();
    tail.start();
    tail.reset(T0 - 1_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(candles.reads.map((r) => r.since)).toEqual([T0 - 1_000, T0 + 5_000]);
    expect(candles.applied).toEqual([T0 + 5_000, T0 + 10_000]);
    tail.stop();
  });

  it('does nothing before a window was drawn (no reset yet)', async () => {
    const { tail, candles } = setup();
    tail.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(candles.reads).toHaveLength(0);
    tail.stop();
  });

  it('skips the tick while the page is loading', async () => {
    let busy = true;
    const { tail, candles } = setup({ busy: () => busy });
    tail.start();
    tail.reset(T0);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(candles.reads).toHaveLength(0);
    busy = false;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(candles.reads).toHaveLength(1);
    tail.stop();
  });

  it('keeps one request in flight per job: a slow answer is not stacked on', async () => {
    const slow = job(CANDLES_EVERY_MS, { manual: true });
    const { tail } = setup({ jobs: [slow.job] });
    tail.start();
    tail.reset(T0);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(slow.reads).toHaveLength(1);
    slow.release();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(slow.applied).toHaveLength(1);
    expect(slow.reads).toHaveLength(2);
    tail.stop();
  });

  it('drops an answer that comes back after the symbol or timeframe changed', async () => {
    const slow = job(CANDLES_EVERY_MS, { manual: true });
    const { tail, bump } = setup({ jobs: [slow.job] });
    tail.start();
    tail.reset(T0);
    await vi.advanceTimersByTimeAsync(5_000);
    bump(); // another symbol was chosen while the read was in flight
    slow.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(slow.applied).toEqual([]);
    tail.stop();
  });

  it('a failed read applies nothing and the next tick asks again from the same point', async () => {
    let fail = true;
    const reads: number[] = [];
    const flaky: TailJob = {
      every: CANDLES_EVERY_MS,
      read: async (since) => { reads.push(since); if (fail) throw new Error('502'); return () => undefined; },
    };
    const { tail } = setup({ jobs: [flaky] });
    tail.start();
    tail.reset(T0);
    await vi.advanceTimersByTimeAsync(5_000);
    fail = false;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(reads).toEqual([T0, T0]);
    tail.stop();
  });

  it('a hidden tab polls nothing; back in view it catches up at once from where it stopped', async () => {
    const { tail, candles, side, doc, reload } = setup();
    tail.start();
    tail.reset(T0);
    await vi.advanceTimersByTimeAsync(60_000);
    const before = { candles: candles.reads.length, side: side.reads.length };

    doc.set('hidden');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(candles.reads).toHaveLength(before.candles);
    expect(side.reads).toHaveLength(before.side);

    doc.set('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).not.toHaveBeenCalled();
    expect(candles.reads).toHaveLength(before.candles + 1);
    expect(side.reads).toHaveLength(before.side + 1);
    // the side read covers the whole absence: it starts where the last one before hiding did
    expect(side.reads.at(-1)!.since).toBe(T0 + 60_000);
    expect(side.reads.at(-1)!.now).toBe(T0 + 180_000);
    // and the timers run again
    await vi.advanceTimersByTimeAsync(5_000);
    expect(candles.reads).toHaveLength(before.candles + 2);
    tail.stop();
  });

  it('back in view after more than a window, it reloads instead of tailing', async () => {
    const { tail, candles, doc, reload } = setup();
    tail.start();
    tail.reset(T0);
    doc.set('hidden');
    await vi.advanceTimersByTimeAsync(WINDOW + 60_000);
    doc.set('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(candles.reads).toHaveLength(0);
    tail.stop();
  });

  it('a tab opened hidden does not poll until it is shown', async () => {
    const { tail, candles, doc } = setup();
    doc.set('hidden');
    tail.start();
    tail.reset(T0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(candles.reads).toHaveLength(0);
    tail.stop();
  });

  it('stop() clears every timer and the listener, and drops a read still in flight', async () => {
    const slow = job(CANDLES_EVERY_MS, { manual: true });
    const { tail, doc } = setup({ jobs: [slow.job] });
    tail.start();
    tail.reset(T0);
    await vi.advanceTimersByTimeAsync(5_000);
    tail.stop();
    expect(doc.listeners).toBe(0);
    slow.release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(slow.reads).toHaveLength(1);
    expect(slow.applied).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

const candle = (time: number) => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 1, takerBuyVolume: 1 });
const panes = (candles: number[], daily: number[] = []) =>
  ({ candles: { candles: candles.map(candle) }, dailyCandles: daily.map(candle) }) as unknown as PaneData;

describe('the tail ranges', () => {
  it('candles: from the open of the last bar on screen, which is still forming', () => {
    expect(candleTailFrom(panes([60, 120]), 999_000)).toBe(120_000);
    expect(candleTailFrom(panes([]), 999_000)).toBe(999_000);
  });

  it('the minute\'s panes: from the start of the bucket the last read ended in', () => {
    const since = Date.UTC(2026, 9, 29, 12, 7, 30);
    expect(sideTailFrom(since, '1m')).toBe(Date.UTC(2026, 9, 29, 12, 7));
    expect(sideTailFrom(since, '15m')).toBe(Date.UTC(2026, 9, 29, 12, 0));
    expect(sideTailFrom(since, '1h')).toBe(Date.UTC(2026, 9, 29, 12, 0));
  });

  it('daily candles: only once a new UTC day has begun, from the day that was forming', () => {
    const today = Date.UTC(2026, 9, 29) / 1000;
    expect(dailyTailFrom(panes([], [today - 86_400, today]), Date.UTC(2026, 9, 29, 23, 59))).toBeNull();
    expect(dailyTailFrom(panes([], [today - 86_400, today]), Date.UTC(2026, 9, 30, 0, 1))).toBe(today * 1000);
    expect(dailyTailFrom(panes([], []), Date.UTC(2026, 9, 30))).toBeNull();
  });
});

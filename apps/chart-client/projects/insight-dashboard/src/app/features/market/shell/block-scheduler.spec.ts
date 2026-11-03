import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BLOCK_INTERVALS_MS, BlockScheduler, liveAge, MAX_BACKOFF_MS } from './block-scheduler';

/** IB-088 (D13) — the schedule, on fake timers. */
const timers = { now: () => Date.now(), setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>) };
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe('BlockScheduler', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());

  it('the cadences are D13\'s', () => {
    expect(BLOCK_INTERVALS_MS).toEqual({ liquidations: 10_000, insights: 60_000, kpis: 60_000, positioning: 60_000, caps: 120_000, sentiment: 120_000, flows: 300_000 });
  });

  it('each block polls at its own cadence: in 120 s, liquidations 13×, kpis 3×, caps 2×', async () => {
    const calls = { liquidations: 0, kpis: 0, caps: 0 };
    const s = new BlockScheduler(timers);
    s.register('liquidations', async () => { calls.liquidations++; });
    s.register('kpis', async () => { calls.kpis++; });
    s.register('caps', async () => { calls.caps++; });
    s.start();
    for (let t = 0; t < 120; t++) { await vi.advanceTimersByTimeAsync(1_000); }
    expect(calls).toEqual({ liquidations: 13, kpis: 3, caps: 2 });
  });

  it('NO OVERLAP: a slow request is not doubled by the next tick', async () => {
    let inFlight = 0; let max = 0; const starts: number[] = [];
    const s = new BlockScheduler(timers);
    s.register('liquidations', () => { starts.push(Date.now()); inFlight++; max = Math.max(max, inFlight); return new Promise<void>((r) => setTimeout(() => { inFlight--; r(); }, 25_000)); });
    s.start();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(max).toBe(1);
    expect(starts).toEqual([0, 35_000]); // the 10 s tick during the 25 s request is skipped; the next waits the cadence
  });

  it('a REFRESH during a request is not dropped: one more runs the moment it lands (a period switch)', async () => {
    let inFlight = 0; let max = 0; const starts: number[] = [];
    const s = new BlockScheduler(timers);
    s.register('insights', () => { starts.push(Date.now()); inFlight++; max = Math.max(max, inFlight); return new Promise<void>((r) => setTimeout(() => { inFlight--; r(); }, 5_000)); });
    s.start();
    await vi.advanceTimersByTimeAsync(1_000);
    s.refresh('insights'); // the period changed while the old period's request is running
    s.refresh('insights'); // twice: still one rerun, not a queue
    await vi.advanceTimersByTimeAsync(20_000);
    expect(max).toBe(1);
    expect(starts).toEqual([0, 5_000]); // not 65 000: without the rerun the old period stays up a minute
  });

  it('a hidden tab polls nothing; returning fires every block once, then resumes', async () => {
    let calls = 0;
    const s = new BlockScheduler(timers);
    s.register('kpis', async () => { calls++; });
    s.start();
    await flush();
    expect(calls).toBe(1);
    s.setVisible(false);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(calls).toBe(1);
    s.setVisible(true);
    await flush();
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(3);
  });

  it('an error backs off ×2 up to 5 min, stays on its own block, and a success resets it', async () => {
    let fail = true; let liqCalls = 0; let kpiCalls = 0;
    const s = new BlockScheduler(timers);
    s.register('liquidations', async () => { liqCalls++; if (fail) throw new Error('502'); });
    s.register('kpis', async () => { kpiCalls++; });
    s.start();
    await flush();
    expect(s.state('liquidations')).toMatchObject({ error: '502', delayMs: 20_000 });
    expect(s.state('kpis')?.error).toBeNull();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(s.state('liquidations')?.delayMs).toBe(40_000);
    for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS);
    expect(s.state('liquidations')?.delayMs).toBe(MAX_BACKOFF_MS);
    fail = false;
    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS);
    expect(s.state('liquidations')).toMatchObject({ error: null, delayMs: 10_000 });
    expect(kpiCalls).toBeGreaterThan(30); // kept its own cadence throughout
    expect(liqCalls).toBeGreaterThan(5);
  });
});

describe('liveAge', () => {
  const blocks = [
    { id: 'liquidations' as const, intervalMs: 10_000, state: { lastOkAt: 95_000 } },
    { id: 'kpis' as const, intervalMs: 60_000, state: { lastOkAt: 50_000 } },
    { id: 'caps' as const, intervalMs: 120_000, state: { lastOkAt: null } },
  ];

  it('the NEWEST update is the age shown: a fresh block is not hidden behind a slow one', () => {
    expect(liveAge(blocks, 100_000)).toEqual({ seconds: 5, stale: [] });
  });

  it('amber when ANY block is past 2× its own cadence, and it is named', () => {
    // liquidations 26 s old > 2 × 10 s; kpis 71 s old < 2 × 60 s
    expect(liveAge(blocks, 121_000)).toEqual({ seconds: 26, stale: ['liquidations'] });
    expect(liveAge(blocks, 171_000)?.stale).toEqual(['liquidations', 'kpis']);
  });

  it('nothing loaded yet is no age at all, not «0 s»', () => {
    expect(liveAge([{ id: 'kpis', intervalMs: 10_000, state: { lastOkAt: null } }], 1)).toBeNull();
  });
});

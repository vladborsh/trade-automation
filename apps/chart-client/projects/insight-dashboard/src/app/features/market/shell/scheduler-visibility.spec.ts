import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockScheduler } from './block-scheduler';
import { bindVisibility, type VisibilitySource } from './scheduler-visibility';

/** IB-BUG-021 — a page loaded in a background tab must not poll until it is shown. */
const timers = { now: () => Date.now(), setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>) };
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

function fakeDoc(initial: DocumentVisibilityState) {
  let listener: (() => void) | null = null;
  const doc = {
    visibilityState: initial,
    addEventListener: (_: 'visibilitychange', fn: () => void) => { listener = fn; },
    removeEventListener: () => { listener = null; },
  } as VisibilitySource & { visibilityState: DocumentVisibilityState };
  const set = (s: DocumentVisibilityState) => { (doc as { visibilityState: DocumentVisibilityState }).visibilityState = s; listener?.(); };
  return { doc, set, attached: () => listener !== null };
}

function page(initial: DocumentVisibilityState) {
  const calls = { liquidations: 0, kpis: 0 };
  const s = new BlockScheduler(timers);
  s.register('liquidations', async () => { calls.liquidations++; });
  s.register('kpis', async () => { calls.kpis++; });
  const d = fakeDoc(initial);
  const detach = bindVisibility(d.doc, s); // before start(), as both pages do
  s.start();
  return { calls, set: d.set, detach, attached: d.attached };
}

describe('bindVisibility (IB-BUG-021)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());

  it('LOADED HIDDEN: not one request for 3 minutes; shown, every block fires once and then keeps its cadence', async () => {
    const p = page('hidden');
    await vi.advanceTimersByTimeAsync(180_000);
    expect(p.calls).toEqual({ liquidations: 0, kpis: 0 });
    p.set('visible');
    await flush();
    expect(p.calls).toEqual({ liquidations: 1, kpis: 1 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(p.calls.liquidations).toBe(2);
  });

  it('loaded visible, then hidden (the case that was already right): polls, then stops', async () => {
    const p = page('visible');
    await flush();
    expect(p.calls).toEqual({ liquidations: 1, kpis: 1 });
    p.set('hidden');
    await vi.advanceTimersByTimeAsync(600_000);
    expect(p.calls).toEqual({ liquidations: 1, kpis: 1 });
  });

  it('detaches its listener', () => {
    const p = page('visible');
    expect(p.attached()).toBe(true);
    p.detach();
    expect(p.attached()).toBe(false);
  });
});

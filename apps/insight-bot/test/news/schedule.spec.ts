import { afterAttempt, dueSources, MAX_BACKOFF_MS, nextDelayMs, type SourceState } from '../../src/news/schedule';
import type { NewsSource } from '../../src/news/sources';

/**
 * IB-027 — when each source is polled, and what a failing one does to the rest.
 *
 * The rules that matter are the failure ones, so most of these are about a source that is down:
 * a tight retry on a dead feed is how a polite client becomes an impolite one, and a shared
 * schedule is how one dead feed starves nine healthy ones.
 */

const FIVE_MIN = 5 * 60_000;
const source = (id: string, pollMs = FIVE_MIN): NewsSource => ({
  id, url: `https://example.test/${id}`, kind: 'rss', shape: 'window', pollMs, followRedirects: true,
});

const NOW = Date.UTC(2026, 9, 12, 12, 0, 0);
const state = (entries: Record<string, SourceState>) => new Map(Object.entries(entries));

describe('polling cadence', () => {
  it('polls a source never attempted, so a cold start fetches everything once', () => {
    const sources = [source('a'), source('b')];
    expect(dueSources(NOW, sources, new Map()).map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('waits for the source\'s own cadence, not a shared one', () => {
    const fast = source('fast', FIVE_MIN);
    const slow = source('slow', 15 * 60_000);
    const polled = state({
      fast: { lastAttemptAt: NOW - 6 * 60_000, consecutiveFailures: 0 },
      slow: { lastAttemptAt: NOW - 6 * 60_000, consecutiveFailures: 0 },
    });
    // six minutes on: the five-minute feed is due, the fifteen-minute one is not
    expect(dueSources(NOW, [fast, slow], polled).map((s) => s.id)).toEqual(['fast']);
  });

  it('is not due one millisecond early and is due exactly on the boundary', () => {
    const s = source('a');
    expect(dueSources(NOW, [s], state({ a: { lastAttemptAt: NOW - FIVE_MIN + 1, consecutiveFailures: 0 } }))).toEqual([]);
    expect(dueSources(NOW, [s], state({ a: { lastAttemptAt: NOW - FIVE_MIN, consecutiveFailures: 0 } }))).toHaveLength(1);
  });
});

describe('a failing source', () => {
  it('backs off, doubling per consecutive failure', () => {
    const s = source('a');
    expect(nextDelayMs(s, 0)).toBe(FIVE_MIN);
    expect(nextDelayMs(s, 1)).toBe(2 * FIVE_MIN);
    expect(nextDelayMs(s, 3)).toBe(8 * FIVE_MIN);
  });

  it('caps the backoff, so a recovered feed is picked up within the hour', () => {
    // without a cap, doubling reaches days and a feed that came back stays dark
    expect(nextDelayMs(source('a'), 20)).toBe(MAX_BACKOFF_MS);
  });

  it('does NOT delay the others — nine healthy feeds keep their cadence', () => {
    const broken = source('broken');
    const healthy = source('healthy');
    const now = NOW;
    const s = state({
      broken: { lastAttemptAt: now - 6 * 60_000, consecutiveFailures: 4 }, // backed off to 80 min
      healthy: { lastAttemptAt: now - 6 * 60_000, consecutiveFailures: 0 },
    });
    expect(dueSources(now, [broken, healthy], s).map((x) => x.id)).toEqual(['healthy']);
  });

  it('clears the failure count on success rather than decrementing it', () => {
    // decrementing would keep a recovered source on a long delay for as many cycles as it failed
    const failedFourTimes: SourceState = { lastAttemptAt: NOW - 1, consecutiveFailures: 4 };
    expect(afterAttempt(failedFourTimes, NOW, true)).toEqual({ lastAttemptAt: NOW, consecutiveFailures: 0 });
  });

  it('accumulates failures across attempts', () => {
    let s = afterAttempt(undefined, NOW, false);
    s = afterAttempt(s, NOW + 1, false);
    expect(s.consecutiveFailures).toBe(2);
  });

  it('counts an attempt even when it failed, so a dead feed is not retried in a tight loop', () => {
    // the bug this prevents: recording lastAttemptAt only on success means a failing source is due
    // again immediately, every tick, for ever
    const s = afterAttempt(undefined, NOW, false);
    expect(s.lastAttemptAt).toBe(NOW);
    expect(dueSources(NOW + 1000, [source('a')], state({ a: s }))).toEqual([]);
  });
});

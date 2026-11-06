import type { LevelBar, LevelEvent, LevelKind } from '@trade-automation/contracts';
import { freshState, levelStep, seedState, touchOf, type LevelState } from '../../../src/alerts/levels/level-step';

/** IB-126 (design P3, P7, P10) — one 15m bar against one level. L = 100 throughout. */
const L = 100;
const P0 = Date.UTC(2026, 10, 2); // Monday: the period start
const M = 900_000;
const bar = (i: number, o: number, h: number, l: number, c: number): LevelBar => ({ openMs: P0 + i * M, open: o, high: h, low: l, close: c });
/** A bar that is a close at `c` with a tight range around it, unless high/low are given. */
const at = (i: number, c: number, h = Math.max(c, 0) + 0.01, l = c - 0.01): LevelBar => bar(i, c, h, l, c);
const state = (lastSide: LevelState['lastSide'], firstBeyondAtMs: number | null = null): LevelState => ({ lastSide, firstBeyondAtMs, lastBarMs: P0 });
const ev = (kind: LevelKind, b: LevelBar, prev: number, s: LevelState | null = freshState(P0)) => levelStep(kind, L, b, prev, s, 0.001).events;

/** Steps a sequence of closes (from the period start) through the live rule, with the once-per-period dedupe of P4. */
function run(kind: LevelKind, bars: LevelBar[], firstPrev: number): { events: LevelEvent[]; all: LevelEvent[] } {
  let s: LevelState | null = freshState(P0);
  let prev = firstPrev;
  const all: LevelEvent[] = [];
  for (const b of bars) {
    const r = levelStep(kind, L, b, prev, s, 0.001);
    all.push(...r.events);
    s = r.state;
    prev = b.close;
  }
  return { events: [...new Set(all)], all };
}

describe('P3 breakout and sweep, both directions', () => {
  it('breakout up of a high level: close above L, the previous close at or below it', () => {
    expect(ev('PWH', at(1, 101), 99)).toEqual(['breakout_up']);
    expect(ev('PWH', at(1, 101), 100)).toEqual(['breakout_up']);
    expect(ev('PWH', at(1, 101), 100.5)).toEqual([]); // already above: not a breakout
  });

  it('breakout down of a low level mirrors it', () => {
    expect(ev('PWL', at(1, 99), 101)).toEqual(['breakout_down']);
    expect(ev('PWL', at(1, 99), 100)).toEqual(['breakout_down']);
    expect(ev('PWL', at(1, 99), 99.5)).toEqual([]);
  });

  it('sweep above: a wick through, a close back below, coming from below', () => {
    expect(ev('PMH', bar(1, 99, 102, 98.5, 99.2), 99)).toEqual(['sweep_above']);
    expect(ev('PMH', bar(1, 99, 102, 98.5, 99.2), 100.5)).toEqual([]); // came from above: not a sweep (and no state above: no cross)
  });

  it('sweep below mirrors it', () => {
    expect(ev('PML', bar(1, 101, 101.5, 98, 100.8), 101)).toEqual(['sweep_below']);
  });

  it('a high level is never swept from below nor broken down; a low level never broken up', () => {
    expect(ev('PWH', at(1, 99), 101)).toEqual([]);
    expect(ev('PWL', at(1, 101), 99)).toEqual([]);
    expect(ev('PWL', bar(1, 99, 102, 98.5, 99.2), 99)).toEqual([]);
  });
});

describe('P3 a touch is not an event', () => {
  it('a close exactly at L: nothing, from either side and for every kind', () => {
    for (const k of ['PWH', 'PWL', 'WO'] as const) {
      expect(ev(k, bar(1, 99, 100, 98, 100), 99)).toEqual([]);
      expect(ev(k, bar(1, 101, 102, 100, 100), 101)).toEqual([]);
    }
  });

  it('a high exactly at L with a close below: no sweep', () => {
    expect(ev('PWH', bar(1, 99, 100, 98, 99), 99)).toEqual([]);
    expect(ev('PWL', bar(1, 101, 102, 100, 101), 101)).toEqual([]);
  });
});

describe('P3 crossunder / crossover (P10 state)', () => {
  it('crossunder of PWH: a close back below after a close above in the period', () => {
    expect(ev('PWH', at(5, 99), 101, state('above', P0 + M))).toEqual(['crossunder']);
  });

  it('crossover of PWL mirrors it', () => {
    expect(ev('PWL', at(5, 101), 99, state('below', P0 + M))).toEqual(['crossover']);
  });

  it('without a close beyond, no crossunder: a wick only is a sweep', () => {
    const { all } = run('PWH', [at(1, 99), bar(2, 99, 102, 98.5, 99.4), at(3, 98)], 98);
    expect(all).toEqual(['sweep_above']);
  });

  it('a close exactly at L does not move last_side', () => {
    const s0 = state('above', P0 + M);
    const r = levelStep('PWH', L, bar(2, 101, 101, 99.5, 100), 101, s0, 0.001);
    expect(r.state).toEqual({ lastSide: 'above', firstBeyondAtMs: P0 + M, lastBarMs: P0 + 2 * M });
    expect(r.events).toEqual([]);
  });

  it('the disputed candle (previous close AT L, an earlier close above, wick above, close below) is a crossunder, not a sweep', () => {
    const r = levelStep('PWH', L, bar(3, 100, 101, 99, 99.5), 100, state('above', P0 + M), 0.001);
    expect(r.events).toEqual(['crossunder']);
    // the same candle with no close above earlier IS a sweep
    expect(levelStep('PWH', L, bar(3, 100, 101, 99, 99.5), 100, state('below'), 0.001).events).toEqual(['sweep_above']);
  });

  it('unseeded (state unknown): breakouts and sweeps still fire, crossunder cannot, and no state is produced', () => {
    const r = levelStep('PWH', L, at(5, 99), 101, null, 0.001);
    expect(r.events).toEqual([]);
    expect(r.state).toBeNull();
    expect(levelStep('PWH', L, at(5, 101), 99, null, 0.001).events).toEqual(['breakout_up']);
  });

  it('a week of chop around PWH: one breakout up and one crossunder once deduped, however many crossings', () => {
    const closes = [99, 101, 99, 101, 99, 100, 101, 98];
    const { events, all } = run('PWH', closes.map((c, i) => at(i + 1, c)), 98);
    expect(all.filter((e) => e === 'breakout_up').length).toBeGreaterThan(1); // the rule fires each time…
    expect(events.sort()).toEqual(['breakout_up', 'crossunder']); // …P4's key lets one of each through
  });

  it('first_beyond_at is the close moment of the FIRST close above, kept through later crossings', () => {
    let s: LevelState | null = freshState(P0);
    let prev = 98;
    for (const b of [at(0, 99), at(1, 101), at(2, 99), at(3, 102)]) {
      s = levelStep('PWH', L, b, prev, s, 0.001).state;
      prev = b.close;
    }
    expect(s).toEqual({ lastSide: 'above', firstBeyondAtMs: P0 + 2 * M, lastBarMs: P0 + 3 * M });
  });

  it('a low level\'s first beyond is its first close BELOW', () => {
    const s = levelStep('PML', L, at(0, 99), 101, freshState(P0), 0.001).state;
    expect(s?.firstBeyondAtMs).toBe(P0 + M);
    expect(levelStep('PML', L, at(0, 101), 99, freshState(P0), 0.001).state?.firstBeyondAtMs).toBeNull();
  });
});

describe('P3 opens: both sides, no crossunder/crossover', () => {
  it('breakout up, then back down: two events, each once', () => {
    const { events } = run('WO', [at(0, 99), at(1, 101), at(2, 102), at(3, 99), at(4, 101)], 99);
    expect(events).toEqual(['breakout_up', 'breakout_down']);
  });

  it('sweeps from both sides', () => {
    expect(ev('MO', bar(1, 99, 101, 98.8, 99.5), 99, null)).toEqual(['sweep_above']);
    expect(ev('MO', bar(1, 101, 101.2, 99, 100.5), 101, null)).toEqual(['sweep_below']);
  });

  it('a previous close exactly at L: the breakout, not also the opposite sweep', () => {
    expect(ev('WO', bar(1, 100, 101, 99, 100.5), 100, null)).toEqual(['breakout_up']);
    expect(ev('WO', bar(1, 100, 101, 99, 99.5), 100, null)).toEqual(['breakout_down']);
  });

  it('an open has no state', () => {
    expect(levelStep('WO', L, at(1, 101), 99, freshState(P0), 0.001).state).toBeNull();
  });
});

describe('P7 touch', () => {
  it('within the band from below or above, without going beyond', () => {
    expect(touchOf(L, { high: 99.95, low: 99 }, 0.001)).toEqual({ from: 'below', distance: expect.closeTo(0.0005, 10) });
    expect(touchOf(L, { high: 100, low: 99 }, 0.001)).toEqual({ from: 'below', distance: 0 });
    expect(touchOf(L, { high: 101, low: 100.05 }, 0.001)).toEqual({ from: 'above', distance: expect.closeTo(0.0005, 10) });
    expect(touchOf(L, { high: 99.8, low: 99 }, 0.001)).toBeNull(); // too far
    // exactly at the band's edge is inside it, from either side (0.125 / 100 is exact in binary)
    expect(touchOf(L, { high: 99.875, low: 99 }, 0.00125)).toEqual({ from: 'below', distance: 0.00125 });
    expect(touchOf(L, { high: 101, low: 100.125 }, 0.00125)).toEqual({ from: 'above', distance: 0.00125 });
    expect(touchOf(L, { high: 100.01, low: 99.9 }, 0.001)).toBeNull(); // went beyond
  });
});

describe('P10 seedState', () => {
  it('equals stepping the period\'s bars live; bars before the period only give the first previous close', () => {
    const bars = [at(-2, 50), at(-1, 101), at(0, 99), at(1, 101), at(2, 100), at(3, 99.5)];
    let live: LevelState | null = freshState(P0);
    let prev = 101;
    for (const b of bars.slice(2)) {
      live = levelStep('PWH', L, b, prev, live, 0.001).state;
      prev = b.close;
    }
    expect(seedState('PWH', L, P0, bars)).toEqual(live);
    expect(seedState('PWH', L, P0, bars)).toEqual({ lastSide: 'below', firstBeyondAtMs: P0 + 2 * M, lastBarMs: P0 + 3 * M });
  });

  it('no bars in the period: the fresh state', () => {
    expect(seedState('PWL', L, P0, [at(-1, 90)])).toEqual(freshState(P0));
  });
});

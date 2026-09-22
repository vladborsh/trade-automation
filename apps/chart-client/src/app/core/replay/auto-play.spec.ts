import { vi } from 'vitest';
import { AutoPlay, DEFAULT_AUTOPLAY_SPEED_MS } from './auto-play';

function setup() {
  const state = { canStep: true, pending: false, steps: 0 };
  const play = new AutoPlay({
    step: () => void state.steps++,
    canStep: () => state.canStep,
    stepPending: () => state.pending,
  });
  return { play, state };
}

describe('AutoPlay (T-052)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('steps once per interval at the default 0.5 s: 3 s → 6 steps; pause stops it', () => {
    const { play, state } = setup();
    expect(play.speedMs()).toBe(DEFAULT_AUTOPLAY_SPEED_MS);
    play.play();
    expect(play.playing()).toBe(true);
    expect(state.steps).toBe(0); // the first step comes after one interval, not at once
    vi.advanceTimersByTime(3_000);
    expect(state.steps).toBe(6);
    play.pause();
    vi.advanceTimersByTime(3_000);
    expect(state.steps).toBe(6);
    expect(play.playing()).toBe(false);
  });

  it('a pending step (in flight, loading or queued, T-037) skips the tick — never piles up', () => {
    const { play, state } = setup();
    play.play();
    state.pending = true;
    vi.advanceTimersByTime(2_000); // four ticks, all while a step is pending
    expect(state.steps).toBe(0);
    state.pending = false;
    vi.advanceTimersByTime(500);
    expect(state.steps).toBe(1); // one step, not the five that would have queued
  });

  it('pauses by itself once stepping is impossible (the period end, a completed session)', () => {
    const { play, state } = setup();
    play.play();
    vi.advanceTimersByTime(1_000);
    expect(state.steps).toBe(2);
    state.canStep = false;
    vi.advanceTimersByTime(500);
    expect(play.playing()).toBe(false);
    vi.advanceTimersByTime(5_000);
    expect(state.steps).toBe(2);
  });

  it('does not start where stepping is impossible (view-only, the end, not started)', () => {
    const { play, state } = setup();
    state.canStep = false;
    play.play();
    expect(play.playing()).toBe(false);
    vi.advanceTimersByTime(5_000);
    expect(state.steps).toBe(0);
  });

  it('speed presets: 0.25 s → 4 steps a second, 2 s → one every two; a change applies at once while playing', () => {
    const { play, state } = setup();
    play.setSpeed(250);
    play.play();
    vi.advanceTimersByTime(1_000);
    expect(state.steps).toBe(4);
    play.setSpeed(2_000);
    vi.advanceTimersByTime(1_999);
    expect(state.steps).toBe(4);
    vi.advanceTimersByTime(1);
    expect(state.steps).toBe(5);
  });

  it('toggle plays and pauses; play twice keeps one timer', () => {
    const { play, state } = setup();
    play.toggle();
    play.play();
    vi.advanceTimersByTime(500);
    expect(state.steps).toBe(1); // not 2: one timer
    play.toggle();
    expect(play.playing()).toBe(false);
  });
});

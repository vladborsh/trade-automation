import { vi } from 'vitest';
import { ChartSyncService, sameRange } from './chart-sync.service';

describe('sameRange', () => {
  it('is false when either range is null', () => {
    expect(sameRange(null, { from: 1, to: 2 }, 1)).toBe(false);
    expect(sameRange({ from: 1, to: 2 }, null, 1)).toBe(false);
    expect(sameRange(null, null, 1)).toBe(false);
  });

  it('is true when both ends are within epsilon', () => {
    expect(sameRange({ from: 100, to: 200 }, { from: 101, to: 199 }, 2)).toBe(true);
  });

  it('is false when either end drifts past epsilon', () => {
    expect(sameRange({ from: 100, to: 200 }, { from: 105, to: 200 }, 2)).toBe(false);
    expect(sameRange({ from: 100, to: 200 }, { from: 100, to: 210 }, 2)).toBe(false);
  });
});

describe('ChartSyncService', () => {
  it('starts with no range and no origin', () => {
    const sync = new ChartSyncService();
    expect(sync.range()).toBeNull();
    expect(sync.origin()).toBeNull();
  });

  it('propose sets the range and records the proposing panel as origin', () => {
    const sync = new ChartSyncService();
    sync.propose('panel-a', { from: 1000, to: 2000 }, 30);
    expect(sync.range()).toEqual({ from: 1000, to: 2000 });
    expect(sync.origin()).toBe('panel-a');
  });

  it('a later proposal from a different panel overwrites the range and origin (latest gesture wins)', () => {
    const sync = new ChartSyncService();
    sync.propose('panel-a', { from: 1000, to: 2000 }, 30);
    sync.propose('panel-b', { from: 1500, to: 2500 }, 30);
    expect(sync.range()).toEqual({ from: 1500, to: 2500 });
    expect(sync.origin()).toBe('panel-b');
  });

  it('drift guard: a proposal within epsilon of the current range is dropped, even from a different panel', () => {
    const sync = new ChartSyncService();
    sync.propose('panel-a', { from: 1000, to: 2000 }, 30);
    sync.propose('panel-b', { from: 1010, to: 1990 }, 30); // within epsilon on both ends
    expect(sync.range()).toEqual({ from: 1000, to: 2000 });
    expect(sync.origin()).toBe('panel-a'); // unchanged — the proposal was dropped
  });

  it('a proposal past epsilon from a different panel is accepted', () => {
    const sync = new ChartSyncService();
    sync.propose('panel-a', { from: 1000, to: 2000 }, 30);
    sync.propose('panel-b', { from: 1100, to: 2000 }, 30); // 100s drift > 30s epsilon
    expect(sync.range()).toEqual({ from: 1100, to: 2000 });
    expect(sync.origin()).toBe('panel-b');
  });

  it('reset clears both range and origin', () => {
    const sync = new ChartSyncService();
    sync.propose('panel-a', { from: 1000, to: 2000 }, 30);
    sync.reset();
    expect(sync.range()).toBeNull();
    expect(sync.origin()).toBeNull();
  });
});

// architecture/panel-sync-and-oi-depth-diagnosis.md bug 1: a SEPARATE channel from the range
// above — it must never interact with `propose()`'s drift guard, origin or circuit breaker,
// since (per the design doc) the crosshair has no feedback loop to police: lightweight-charts
// never fires `subscribeCrosshairMove` for a programmatic position, so there is no echo a
// follower could bounce back through this service in the first place.
describe('ChartSyncService crosshair channel', () => {
  it('starts with no crosshair', () => {
    const sync = new ChartSyncService();
    expect(sync.crosshair()).toBeNull();
  });

  it('setCrosshair sets the origin panel and the hovered time', () => {
    const sync = new ChartSyncService();
    sync.setCrosshair('btc', 12_345);
    expect(sync.crosshair()).toEqual({ origin: 'btc', timeSec: 12_345 });
  });

  it('setCrosshair(panelId, null) clears it', () => {
    const sync = new ChartSyncService();
    sync.setCrosshair('btc', 12_345);
    sync.setCrosshair('btc', null);
    expect(sync.crosshair()).toBeNull();
  });

  it('reset() clears the crosshair too', () => {
    const sync = new ChartSyncService();
    sync.setCrosshair('btc', 12_345);
    sync.reset();
    expect(sync.crosshair()).toBeNull();
  });

  it('writing the crosshair never changes range()/origin(), and vice versa', () => {
    const sync = new ChartSyncService();
    sync.propose('btc', { from: 1000, to: 2000 }, 30);
    sync.setCrosshair('eth', 1500);
    expect(sync.range()).toEqual({ from: 1000, to: 2000 });
    expect(sync.origin()).toBe('btc');
    expect(sync.crosshair()).toEqual({ origin: 'eth', timeSec: 1500 });

    sync.setCrosshair('eth', null);
    expect(sync.range()).toEqual({ from: 1000, to: 2000 });
    expect(sync.origin()).toBe('btc');
  });
});

// architecture/scroll-back-freeze-diagnosis.md: a follower whose own data
// has a real gap gets its requested range snapped by lightweight-charts to
// something far outside epsilon. Without the read-back fix in
// ChartComponent's Follow effect, this produces an unbounded bounce: the
// follower keeps re-proposing its snapped range, the driver's range keeps
// changing in response, and the *origin* of the shared range keeps
// ping-ponging between panels forever ("ping-ponging between btc, eth,
// btc-oi, and dxy" per the diagnosis file's repro). These tests exercise
// ChartSyncService's circuit breaker directly — the backstop that must trip
// on that origin-ping-pong signature even if some other, not-yet-discovered
// case causes the same kind of bounce, while never tripping on a real
// single-panel drag (verified live: an early volume-based design, counting
// raw propose() calls per panel, falsely tripped on one continuous drag,
// since lightweight-charts fires a range-change on every animation frame
// while panning — see REPORT.md).
describe('ChartSyncService circuit breaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never trips on a real continuous single-panel drag, no matter how many range-change events it fires', () => {
    const sync = new ChartSyncService();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // lightweight-charts fires visibleTimeRangeChange on every animation
    // frame while the user pans — dozens of propose() calls from the SAME
    // panel, all within a few hundred ms, is normal for one drag gesture.
    for (let i = 0; i < 30; i++) {
      sync.propose('dxy', { from: 1000 + i * 100, to: 2000 + i * 100 }, 30); // step > epsilon: each one is a real change, not drift-guarded
    }

    expect(sync.range()).toEqual({ from: 1000 + 29 * 100, to: 2000 + 29 * 100 });
    expect(sync.origin()).toBe('dxy');
    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
  });

  it('normal 4-panel negotiation (one drive + 3 follow settle-echoes, ~4 takeovers) never trips the breaker', () => {
    const sync = new ChartSyncService();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // One user drag on "btc", each of the other 3 panels follows and
    // settle-echoes back once — a realistic ~4-takeover negotiation for a
    // single legitimate gesture on a 4-panel grid (this is what the
    // TRIP_THRESHOLD=8 was calibrated against; a threshold of 3 tripped on
    // exactly this shape during live verification).
    sync.propose('btc', { from: 1000, to: 2000 }, 30);
    sync.propose('eth', { from: 1010, to: 2010 }, 30);
    sync.propose('btc-oi', { from: 1020, to: 2020 }, 30);
    sync.propose('dxy', { from: 1030, to: 2030 }, 30);
    sync.propose('btc', { from: 1040, to: 2040 }, 30);

    expect(sync.range()).toEqual({ from: 1040, to: 2040 });
    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
  });

  it('trips after more than 8 origin takeovers within 750ms and drops further proposals from any panel', () => {
    const sync = new ChartSyncService();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Simulate the diagnosed cascade: the shared-range "owner" ping-pongs
    // between panels well beyond what a single legitimate 4-panel gesture
    // ever produces — 10 alternating proposals is 9 takeovers, tripping
    // after the 9th.
    const panels = ['btc', 'eth'];
    for (let i = 0; i < 9; i++) {
      sync.propose(panels[i % 2], { from: 1000 + i * 100, to: 2000 + i * 100 }, 30);
    }
    const lastAccepted = { from: 1000 + 8 * 100, to: 2000 + 8 * 100 };
    expect(sync.range()).toEqual(lastAccepted);

    // 10th proposal is the 9th takeover: trips the breaker, dropped.
    sync.propose('eth', { from: 2000, to: 3000 }, 30);
    expect(sync.range()).toEqual(lastAccepted); // breaker dropped it
    expect(warn).toHaveBeenCalledOnce();

    // Further proposals — from any panel — are dropped during cooldown, so
    // the range stops changing: the loop converges instead of continuing
    // indefinitely.
    sync.propose('btc', { from: 2100, to: 3100 }, 30);
    sync.propose('eth', { from: 2200, to: 3200 }, 30);
    expect(sync.range()).toEqual(lastAccepted);

    warn.mockRestore();
  });

  it('does not trip the breaker for a legitimate rapid sequence of real gestures across a handful of panels', () => {
    const sync = new ChartSyncService();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // A human switching gestures between panels a couple of times inside
    // 750ms — well under the takeover threshold that only a machine-speed
    // bounce reaches.
    sync.propose('btc', { from: 1000, to: 2000 }, 30);
    sync.propose('eth', { from: 1100, to: 2100 }, 30);
    sync.propose('dxy', { from: 1300, to: 2300 }, 30);

    expect(sync.range()).toEqual({ from: 1300, to: 2300 });
    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
  });

  it('recovers after the cooldown window: a proposal from any panel is accepted again', () => {
    const sync = new ChartSyncService();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const panels = ['btc', 'eth'];
    for (let i = 0; i < 9; i++) {
      sync.propose(panels[i % 2], { from: 1000 + i * 100, to: 2000 + i * 100 }, 30);
    }
    sync.propose('eth', { from: 2000, to: 3000 }, 30); // trips
    const lastAccepted = { from: 1000 + 8 * 100, to: 2000 + 8 * 100 };
    expect(sync.range()).toEqual(lastAccepted);

    vi.advanceTimersByTime(751); // past COOLDOWN_MS

    sync.propose('btc', { from: 1500, to: 2500 }, 30);
    expect(sync.range()).toEqual({ from: 1500, to: 2500 });

    warn.mockRestore();
  });

  it('a stable, converged range (no further meaningful proposals) never trips the breaker', () => {
    const sync = new ChartSyncService();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Fix scenario: after the Follow effect's read-back fix, a follower that
    // snapped once settles — its next proposal (if any) is within epsilon of
    // the current shared range and is dropped by the pre-existing drift
    // guard before it ever counts as a takeover.
    sync.propose('btc', { from: 1000, to: 2000 }, 30);
    sync.propose('dxy', { from: 1005, to: 1995 }, 30); // within epsilon: settled
    sync.propose('dxy', { from: 1005, to: 1995 }, 30);
    sync.propose('dxy', { from: 1005, to: 1995 }, 30);

    expect(sync.range()).toEqual({ from: 1000, to: 2000 }); // drift guard held, no bounce
    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
  });
});

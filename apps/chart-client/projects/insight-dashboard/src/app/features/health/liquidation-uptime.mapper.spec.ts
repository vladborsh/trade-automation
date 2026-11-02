import type { WebLiquidationUptime } from '@trade-automation/contracts';
import { ageSec, anyMissing, uptimeStateClass, uptimeStateKey, windowOf } from './liquidation-uptime.mapper';

const row = (states: Array<'recorded' | 'no_events' | 'not_recorded'>): WebLiquidationUptime => ({
  stream: 'okx:liquidation-orders', venue: 'okx', instrumented: true, lastRowAt: 1_000, lastSeen: 2_000,
  windows: states.map((state, i) => ({ hours: i === 0 ? 24 : 168, state, coveredHours: 1, elapsedHours: 1, outages: 0, rows: 0 })),
});

describe('liquidation uptime mapper (WD-009)', () => {
  it('names each state with its own key, and only not_recorded is a warning', () => {
    expect(uptimeStateKey('recorded')).toBe('health.uptime.state.recorded');
    expect(uptimeStateKey('no_events')).toBe('health.uptime.state.no_events');
    expect(uptimeStateKey('not_recorded')).toBe('health.uptime.state.not_recorded');
    expect([uptimeStateClass('recorded'), uptimeStateClass('no_events'), uptimeStateClass('not_recorded')]).toEqual(['ok', 'quiet', 'missing']);
  });

  it('finds a window by its length, not its position', () => {
    const r = row(['recorded', 'no_events']);
    r.windows.reverse();
    expect(windowOf(r, 24)?.state).toBe('recorded');
    expect(windowOf(r, 168)?.state).toBe('no_events');
    expect(windowOf(r, 1)).toBeNull();
  });

  it('ages an epoch-ms instant in seconds and keeps "never" as null', () => {
    expect(ageSec(10_000, 70_000)).toBe(60);
    expect(ageSec(null, 70_000)).toBeNull();
    expect(ageSec(80_000, 70_000)).toBe(0); // a clock a little ahead is not a negative age
  });

  it('warns when any window may be missing liquidations, and only then', () => {
    expect(anyMissing([row(['recorded', 'no_events'])])).toBe(false);
    expect(anyMissing([row(['recorded', 'no_events']), row(['no_events', 'not_recorded'])])).toBe(true);
    expect(anyMissing([])).toBe(false);
  });
});

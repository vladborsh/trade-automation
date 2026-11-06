import { CustomLevelAlertDetailsSchema, type LevelBar } from '@trade-automation/contracts';
import { customLevelAlerts } from '../../../src/alerts/levels/custom-level-step';
import type { CustomLevel } from '../../../src/alerts/levels/pg/custom-levels.repo';

/** IB-128 (design §4 P9) — one 15m bar against a coin's custom levels. */
const M = 900_000;
const DAY = 86_400_000;
const T = Date.UTC(2026, 10, 11, 10, 0);
const bar = (o: number, h: number, l: number, c: number, openMs = T): LevelBar => ({ openMs, open: o, high: h, low: l, close: c });
const level = (x: Partial<CustomLevel> = {}): CustomLevel => ({
  id: 7, symbol: 'BTCUSDT', price: 100, note: null, events: {}, createdBy: 1, createdAtMs: T - DAY, ...x,
});
const events = (bars: LevelBar, prev: number, levels = [level()]) => customLevelAlerts('BTCUSDT', levels, bars, prev, false).map((a) => a.event);

describe('IB-128 custom level step', () => {
  it('P9: from both sides as an open — breakout up and down', () => {
    expect(events(bar(99, 101, 98, 100.5), 99)).toEqual(['breakout_up']);
    expect(events(bar(101, 102, 99, 99.5), 101)).toEqual(['breakout_down']);
  });

  it('P9: sweeps from both sides', () => {
    expect(events(bar(99, 101, 98, 99.5), 99)).toEqual(['sweep_above']);
    expect(events(bar(101, 102, 99, 100.5), 101)).toEqual(['sweep_below']);
  });

  it('P9: no crossunder/crossover — a close back below after closes above is a breakout down', () => {
    // previous close above, now below: for a PWH this would be a crossunder; for a custom level it is a breakout down
    expect(events(bar(101, 101.5, 99, 99.5), 101)).toEqual(['breakout_down']);
  });

  it('a close exactly at L, or a bar that never reached it, is nothing', () => {
    expect(events(bar(99, 101, 98, 100), 99)).toEqual([]);
    expect(events(bar(95, 96, 94, 95.5), 95)).toEqual([]);
  });

  it('the level\'s own switches: a switched-off event is muted (IB-151: journalled, its own key), the others stay', () => {
    const off = [level({ events: { breakout_up: false } })];
    const [muted] = customLevelAlerts('BTCUSDT', off, bar(99, 101, 98, 100.5), 99, false);
    expect(muted).toMatchObject({ event: 'breakout_up', mutedBy: 'custom_event', dedupeKey: `level:BTCUSDT:custom-7:${Date.UTC(2026, 10, 11)}:breakout_up:muted` });
    const [on] = customLevelAlerts('BTCUSDT', off, bar(101, 102, 99, 99.5), 101, false);
    expect(on.event).toBe('breakout_down');
    expect(on.mutedBy).toBeUndefined();
  });

  it('another coin\'s level, or one added after the bar closed, does not fire; one added before the close does', () => {
    expect(events(bar(99, 101, 98, 100.5), 99, [level({ symbol: 'ETHUSDT' })])).toEqual([]);
    expect(events(bar(99, 101, 98, 100.5), 99, [level({ createdAtMs: T + M })])).toEqual([]);
    expect(events(bar(99, 101, 98, 100.5), 99, [level({ createdAtMs: T + M - 1 })])).toEqual(['breakout_up']);
  });

  it('P9: the once-key is per level, event and the UTC day of the bar\'s open; details parse', () => {
    const late = Date.UTC(2026, 10, 11, 23, 45);
    const [a] = customLevelAlerts('BTCUSDT', [level()], bar(99, 101, 98, 100.5, late), 99, true);
    const day = Date.UTC(2026, 10, 11);
    expect(a.dedupeKey).toBe(`level:BTCUSDT:custom-7:${day}:breakout_up`);
    expect(a).toMatchObject({ event: 'breakout_up', direction: 'bullish', atMs: late, late: true });
    expect(CustomLevelAlertDetailsSchema.parse(a.details)).toEqual({
      kind: 'custom', levelId: 7, price: 100, note: null, dayStartMs: day, bar: bar(99, 101, 98, 100.5, late), prevClose: 99,
    });
    const [next] = customLevelAlerts('BTCUSDT', [level()], bar(99, 101, 98, 100.5, late + M), 99, false);
    expect(next.dedupeKey).toBe(`level:BTCUSDT:custom-7:${day + DAY}:breakout_up`);
  });

  it('two levels on one bar give one alert each', () => {
    const two = [level(), level({ id: 8, price: 100.2 })];
    expect(customLevelAlerts('BTCUSDT', two, bar(99, 101, 98, 100.5), 99, false).map((a) => a.dedupeKey.split(':')[2])).toEqual(['custom-7', 'custom-8']);
  });
});

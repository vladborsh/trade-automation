import { STALE_AFTER_MS } from '../../src/collectors/uptime/uptime.recorder';
import { LIQUIDATION_STREAMS } from '../../src/collectors/uptime/liquidation-streams';
import { liquidationUptime } from '../../src/web/liquidation-uptime';

/**
 * WD-009 — the liquidation collectors' three states. The property that matters: "no rows" is
 * `no_events` ONLY when the collector listened for the whole window; anything less is
 * `not_recorded`, because the tape cannot tell a quiet market from nobody listening.
 */
const H = 3_600_000;
const NOW = new Date(Date.UTC(2026, 10, 2, 12));
const STREAM = { stream: 'bybit:allLiquidation', venue: 'bybit' };
const beat = (firstSeenAgoH: number, lastSeenAgoMs = 10_000) => new Map([[STREAM.stream, {
  stream: STREAM.stream, venue: 'bybit', market: 'perp' as const,
  firstSeenAt: new Date(NOW.getTime() - firstSeenAgoH * H), lastSeenAt: new Date(NOW.getTime() - lastSeenAgoMs),
}]]);
const activity = (rows24h: number, rows7d: number) =>
  new Map([['bybit', { lastRowAt: new Date(NOW.getTime() - H), rows24h, rows7d }]]);
const run = (...args: Parameters<typeof liquidationUptime> extends [unknown, ...infer R] ? R : never) =>
  liquidationUptime([STREAM], ...args)[0];

describe('liquidationUptime (WD-009)', () => {
  it('rows in the window → recorded, with the newest row and last heartbeat', () => {
    const u = run(beat(400), [], activity(5, 40), NOW);
    expect(u.windows.map((w) => [w.hours, w.state, w.rows])).toEqual([[24, 'recorded', 5], [168, 'recorded', 40]]);
    expect(u).toMatchObject({ instrumented: true, lastRowAt: NOW.getTime() - H });
  });

  it('no rows, listening the whole window → no_events', () => {
    const u = run(beat(400), [], new Map(), NOW);
    expect(u.windows.map((w) => w.state)).toEqual(['no_events', 'no_events']);
    expect(u.windows[1]).toMatchObject({ coveredHours: 168, elapsedHours: 168, outages: 0 });
  });

  it('no rows and an outage inside the window → not_recorded, outage counted, hours subtracted', () => {
    const gap = { stream: STREAM.stream, gapFrom: new Date(NOW.getTime() - 10 * H), gapTo: new Date(NOW.getTime() - 7 * H) };
    const u = run(beat(400), [gap], new Map(), NOW);
    expect(u.windows[0]).toMatchObject({ state: 'not_recorded', coveredHours: 21, outages: 1 });
  });

  it('a collector younger than the window is not_recorded for it, even with no outage rows', () => {
    const u = run(beat(30), [], new Map(), NOW); // born 30 h ago: covers the 24 h, not the 7 d
    expect(u.windows.map((w) => w.state)).toEqual(['no_events', 'not_recorded']);
    expect(u.windows[1]).toMatchObject({ coveredHours: 30, elapsedHours: 168 });
  });

  it('a stale heartbeat (not listening now, gap row not yet written) is subtracted', () => {
    const u = run(beat(400, 2 * H), [], new Map(), NOW);
    expect(u.windows[0]).toMatchObject({ state: 'not_recorded', coveredHours: 22 });
    // a heartbeat only a little late is not an outage
    expect(run(beat(400, STALE_AFTER_MS - 1), [], new Map(), NOW).windows[0].state).toBe('no_events');
  });

  it('a stream with no heartbeat is never no_events — instrumented:false, nothing covered', () => {
    const u = run(new Map(), [], new Map(), NOW);
    expect(u).toMatchObject({ instrumented: false, lastSeen: null, lastRowAt: null });
    expect(u.windows.map((w) => [w.state, w.coveredHours])).toEqual([['not_recorded', 0], ['not_recorded', 0]]);
  });

  it('rows still count as recorded even from an uninstrumented stream (the tape has them)', () => {
    expect(run(new Map(), [], activity(1, 1), NOW).windows[0].state).toBe('recorded');
  });

  it('reports all three venues the collectors heartbeat under, Binance included', () => {
    expect(LIQUIDATION_STREAMS.map((s) => s.venue)).toEqual(['binance', 'bybit', 'okx']);
    const all = liquidationUptime(LIQUIDATION_STREAMS, new Map(), [], new Map(), NOW);
    expect(all.map((u) => u.stream)).toEqual(['binance:forceOrder', 'bybit:allLiquidation', 'okx:liquidation-orders']);
  });
});

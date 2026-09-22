import { signal } from '@angular/core';
import type { Candle, SessionPanel, Timeframe } from '@trade-automation/contracts';
import type { ReplayEngine } from './replay-engine';
import { ReplayPanelSource } from './replay-panel-source';

const M5 = 300_000;
const H = 3_600_000;
const T = Date.UTC(2026, 8, 18, 20, 0); // Friday 20:00
const bar = (openTime: number, close = 104, timeframe: Timeframe = '5m'): Candle =>
  ({ instrument: 'capitalcom:DXY', timeframe, openTime, open: close, high: close + 0.1, low: close - 0.1, close, volume: 1, closed: true, source: 'resampled' }) as Candle;

/** A DXY tape that stops at 21:00 (the Friday close) while the crypto cursor carries on. */
function setup(indicators: SessionPanel['indicators'] = [{ id: 'ema', params: { length: 3 } }]) {
  const closed = Array.from({ length: 13 }, (_, i) => bar(T + i * M5, 104 + i * 0.01)); // 20:00 … 21:00
  const series = signal<{ closed: Candle[]; forming: Candle | null }>({ closed, forming: null });
  const timeframe = signal<Timeframe>('5m');
  const cursor = signal(T + 13 * M5 + 2 * 60_000); // 21:07: the tape's last bar (21:00) is one bucket behind
  const engine = { seriesFor: () => series, timeframe, cursor, loadOlder: async () => undefined } as unknown as ReplayEngine;
  const panel = { id: 'dxy', kind: 'candles', instrument: 'capitalcom:DXY', signals: false, indicators } as SessionPanel;
  return { source: new ReplayPanelSource(panel, engine), series, timeframe, cursor, closed };
}

describe('ReplayPanelSource padding (T-056, option A)', () => {
  it('pads every missing bucket up to the cursor\'s; candles stay the real bars only', () => {
    const { source, cursor, closed } = setup();
    expect(source.whitespace()).toEqual([T + 13 * M5]);
    cursor.set(T + 3 * H + 2 * 60_000); // 23:02, well into the weekend gap
    expect(source.whitespace()[0]).toBe(T + 13 * M5);
    expect(source.whitespace().at(-1)).toBe(T + 3 * H);
    expect(source.candles()).toEqual(closed); // no padding among the candles
  });

  it('no padding reaches the indicators: every point sits on a real bar\'s time', () => {
    const { source, cursor, closed } = setup();
    cursor.set(T + 3 * H);
    const barTimes = new Set(closed.map((c) => c.openTime));
    expect(source.indicatorPoints().length).toBeGreaterThan(0);
    expect(source.indicatorPoints().every((p) => barTimes.has(p.time))).toBe(true);
  });

  it('no padding reaches the position tools: they get the source\'s tools binding untouched, and the last close is a real bar\'s', () => {
    const { source, cursor } = setup();
    cursor.set(T + 3 * H);
    expect(source.positionTools).toBeUndefined(); // the tools binding is the store's (it reads the engine's bars, not this padding)
    expect(source.candles().at(-1)?.close).toBeCloseTo(104.12, 9); // the position tool's last close: the Friday bar
  });

  it('a real bar takes its bucket at the reopen; the rest of the gap stays padded', () => {
    const { source, series, cursor, closed } = setup();
    cursor.set(T + 16 * M5 + 60_000); // 21:21
    expect(source.whitespace()).toEqual([T + 13 * M5, T + 14 * M5, T + 15 * M5, T + 16 * M5]);
    series.set({ closed: [...closed, bar(T + 15 * M5)], forming: bar(T + 16 * M5) }); // reopened at 21:15
    expect(source.whitespace()).toEqual([T + 13 * M5, T + 14 * M5]); // the interior gap keeps its padding
  });

  it('recomputed on loadOlder: an older gap is padded once its history is in', () => {
    const { source, series, closed, cursor } = setup();
    cursor.set(T + 13 * M5); // 21:05 boundary: nothing after 21:00
    expect(source.whitespace()).toEqual([]);
    const older = [bar(T - 4 * M5), bar(T - 3 * M5)]; // 19:40, 19:45 — then nothing until 20:00
    series.set({ closed: [...older, ...closed], forming: null }); // what loadOlder does to the engine's series
    expect(source.whitespace()).toEqual([T - 2 * M5, T - M5]);
  });

  it('recomputed at the panel\'s timeframe on a switch (never carried over)', () => {
    const { source, timeframe, series, cursor } = setup();
    cursor.set(T + 3 * H + 10 * 60_000); // 23:10
    series.set({ closed: [bar(T, 104, '1h'), bar(T + H, 104, '1h')], forming: null }); // the 1h series: 20:00, 21:00
    timeframe.set('1h');
    expect(source.whitespace()).toEqual([T + 2 * H, T + 3 * H]);
  });
});

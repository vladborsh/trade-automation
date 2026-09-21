import { vi } from 'vitest';
import type { IChartApi, ISeriesApi, MouseEventParams, Time } from 'lightweight-charts';
import { ChartCrosshair, type CrosshairHost } from './chart-crosshair';
import type { ChartSyncService } from './chart-sync.service';
import { logicalToTimeSec } from './chart-time';

const TF_SEC = 300;
const TIMES = [0, 300, 600, 900];
const CLOSES = [10, 11, 12, 13];

function setup(overrides: Partial<CrosshairHost> = {}) {
  const chart = { clearCrosshairPosition: vi.fn(), setCrosshairPosition: vi.fn() };
  const series = {} as ISeriesApi<'Candlestick'>;
  const sync = { setCrosshair: vi.fn() };
  const host: CrosshairHost = {
    chart: () => chart as unknown as IChartApi,
    series: () => series,
    panelId: () => 'btc',
    timesSec: () => TIMES,
    tfSec: () => TF_SEC,
    valueAt: (idx) => CLOSES[idx],
    ...overrides,
  };
  const crosshair = new ChartCrosshair(host, sync as unknown as ChartSyncService);
  return { crosshair, chart, series, sync };
}

function move(param: Partial<MouseEventParams<Time>>): MouseEventParams<Time> {
  return param as MouseEventParams<Time>;
}

describe('ChartCrosshair.follow (the Follow effect, moved out of ChartComponent)', () => {
  it('does nothing before the chart exists', () => {
    const { crosshair, chart } = setup({ chart: () => null });
    crosshair.follow({ origin: 'eth', timeSec: 300 });
    expect(chart.setCrosshairPosition).not.toHaveBeenCalled();
    expect(crosshair.time()).toBeNull();
  });

  it('clears the crosshair when the shared one is cleared', () => {
    const { crosshair, chart } = setup();
    crosshair.time.set(600);
    crosshair.follow(null);
    expect(chart.clearCrosshairPosition).toHaveBeenCalledTimes(1);
    expect(crosshair.time()).toBeNull();
  });

  it('leaves the driving panel alone', () => {
    const { crosshair, chart } = setup();
    crosshair.follow({ origin: 'btc', timeSec: 300 });
    expect(chart.setCrosshairPosition).not.toHaveBeenCalled();
    expect(chart.clearCrosshairPosition).not.toHaveBeenCalled();
  });

  it('a follower snaps to its nearest bar and shows that bar’s value', () => {
    const { crosshair, chart, series } = setup();
    crosshair.follow({ origin: 'eth', timeSec: 640 }); // nearest bar: 600
    expect(chart.setCrosshairPosition).toHaveBeenCalledWith(12, 600, series);
    expect(crosshair.time()).toBe(600);
  });

  it('draws nothing without bars or without a value at the nearest bar', () => {
    const empty = setup({ timesSec: () => [] });
    empty.crosshair.follow({ origin: 'eth', timeSec: 300 });
    expect(empty.chart.setCrosshairPosition).not.toHaveBeenCalled();

    const noValue = setup({ valueAt: () => undefined });
    noValue.crosshair.follow({ origin: 'eth', timeSec: 300 });
    expect(noValue.chart.setCrosshairPosition).not.toHaveBeenCalled();
    expect(noValue.crosshair.time()).toBeNull();
  });
});

describe('ChartCrosshair.drive (the subscribeCrosshairMove handler, moved out of ChartComponent)', () => {
  it('publishes the hovered instant from the logical index, void included', () => {
    const { crosshair, sync } = setup();
    crosshair.drive(move({ point: { x: 1, y: 1 } as never, sourceEvent: {} as never, logical: 5 as never }));
    const expected = logicalToTimeSec(5, TIMES, TF_SEC);
    expect(crosshair.time()).toBe(expected);
    expect(sync.setCrosshair).toHaveBeenCalledWith('btc', expected);
  });

  it('a mouse-leave clears this panel’s crosshair and the shared one', () => {
    const { crosshair, sync } = setup();
    crosshair.time.set(300);
    crosshair.drive(move({ point: undefined }));
    expect(crosshair.time()).toBeNull();
    expect(sync.setCrosshair).toHaveBeenCalledWith('btc', null);
  });

  it('ignores a synthetic move (no sourceEvent) and a move without a logical index', () => {
    const { crosshair, sync } = setup();
    crosshair.drive(move({ point: { x: 1, y: 1 } as never, sourceEvent: undefined, logical: 2 as never }));
    crosshair.drive(move({ point: { x: 1, y: 1 } as never, sourceEvent: {} as never, logical: undefined }));
    expect(sync.setCrosshair).not.toHaveBeenCalled();
    expect(crosshair.time()).toBeNull();
  });
});

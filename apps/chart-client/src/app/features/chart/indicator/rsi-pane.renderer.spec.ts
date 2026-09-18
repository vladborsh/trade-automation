import type { IChartApi } from 'lightweight-charts';
import type { Candle } from '@trade-automation/contracts';
import { RsiPaneRenderer } from './rsi-pane.renderer';

interface FakeSeries {
  setData: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  applyOptions: ReturnType<typeof vi.fn>;
  createPriceLine: ReturnType<typeof vi.fn>;
  getPane: () => { setStretchFactor: ReturnType<typeof vi.fn>; attachPrimitive: ReturnType<typeof vi.fn>; detachPrimitive: ReturnType<typeof vi.fn> };
  priceScale: () => { applyOptions: ReturnType<typeof vi.fn> };
}

function fakeChart() {
  const created: { series: FakeSeries; paneIndex: number | undefined }[] = [];
  const chart = {
    addSeries: vi.fn((_def: unknown, _opts: unknown, paneIndex?: number) => {
      const pane = { setStretchFactor: vi.fn(), attachPrimitive: vi.fn(), detachPrimitive: vi.fn() };
      const series: FakeSeries = {
        setData: vi.fn(),
        update: vi.fn(),
        applyOptions: vi.fn(),
        createPriceLine: vi.fn(),
        getPane: () => pane,
        priceScale: () => ({ applyOptions: vi.fn() }),
      };
      created.push({ series, paneIndex });
      return series;
    }),
    removeSeries: vi.fn(),
    panes: () => [{ getStretchFactor: () => 2 }],
  };
  return { chart, created, api: chart as unknown as IChartApi };
}

function candles(n: number, start = 0): Candle[] {
  return Array.from({ length: n }, (_, k) => {
    const i = start + k;
    const close = 100 + Math.sin(i / 3) * 5;
    return {
      instrument: 'binance:BTCUSDT',
      timeframe: '1m',
      openTime: 1_700_000_000_000 + i * 60_000,
      open: close,
      high: close,
      low: close,
      close,
      volume: 0,
      closed: true,
      source: 'venue-rest',
    } as Candle;
  });
}

describe('RsiPaneRenderer', () => {
  it('creates the series in pane 1 with 70/30 guides and a full setData on attach', () => {
    const { chart, created, api } = fakeChart();
    new RsiPaneRenderer().attach(api, candles(200), 14);
    expect(chart.addSeries).toHaveBeenCalledTimes(1);
    const { series, paneIndex } = created[0];
    expect(paneIndex).toBe(1);
    expect(series.getPane().setStretchFactor).toHaveBeenCalledWith(2 / 3); // ~25 % against the price pane's 2
    expect(series.createPriceLine.mock.calls.map((c) => c[0].price)).toEqual([70, 30]);
    expect(series.setData).toHaveBeenCalledTimes(1);
    expect(series.setData.mock.calls[0][0].length).toBe(200 - 140);
  });

  it('attaches the day-separators primitive to the RSI pane and detaches it on hide', () => {
    const { created, api } = fakeChart();
    const r = new RsiPaneRenderer();
    r.attach(api, candles(200), 14);
    const pane = created[0].series.getPane();
    expect(pane.attachPrimitive).toHaveBeenCalledWith(r.separators);
    r.setVisible(false);
    expect(pane.detachPrimitive).toHaveBeenCalledWith(r.separators);
  });

  it('uses update() for a forming-bar update and an append, setData for a prepend or period change', () => {
    const { created, api } = fakeChart();
    const r = new RsiPaneRenderer();
    const base = candles(200, 100);
    r.attach(api, base, 14);
    const s = created[0].series;

    const forming = [...base.slice(0, -1), { ...base[199], close: base[199].close + 1 }];
    r.render(forming, 14);
    expect(s.update).toHaveBeenCalledTimes(1);
    expect(s.setData).toHaveBeenCalledTimes(1);

    const appended = [...forming, ...candles(1, 300)];
    r.render(appended, 14);
    expect(s.update).toHaveBeenCalledTimes(3); // refresh the closed bar, then append the new one
    expect(s.setData).toHaveBeenCalledTimes(1);

    r.render([...candles(100, 0), ...appended], 14); // loadOlder() prepend
    expect(s.setData).toHaveBeenCalledTimes(2);

    r.render([...candles(100, 0), ...appended], 21);
    expect(s.setData).toHaveBeenCalledTimes(3);
    expect(s.applyOptions).toHaveBeenLastCalledWith({ title: 'RSI 21' });
  });

  it('hiding removes the series (and with it the pane); showing re-adds it with a full setData', () => {
    const { chart, created, api } = fakeChart();
    const r = new RsiPaneRenderer();
    r.attach(api, candles(200), 14);
    r.configure(false, 14, candles(200));
    expect(chart.removeSeries).toHaveBeenCalledWith(created[0].series);
    expect(r.isShown()).toBe(false);

    r.render(candles(201), 14); // ticks while hidden draw nothing
    expect(chart.addSeries).toHaveBeenCalledTimes(1);

    r.configure(true, 14, candles(201));
    expect(chart.addSeries).toHaveBeenCalledTimes(2);
    expect(created[1].series.setData.mock.calls[0][0].length).toBe(201 - 140);
    expect(r.isShown()).toBe(true);
  });

  it('draws nothing before attach and honours a hidden state set before attach', () => {
    const { chart, api } = fakeChart();
    const r = new RsiPaneRenderer();
    r.configure(false, 14, candles(200));
    r.attach(api, candles(200), 14);
    expect(chart.addSeries).not.toHaveBeenCalled();
  });
});

describe('RsiPaneRenderer.renderAround', () => {
  it('clears stale RSI before a non-continuation price render, then redraws after it', () => {
    const { created, api } = fakeChart();
    const r = new RsiPaneRenderer();
    r.attach(api, candles(200), 14);
    const s = created[0].series;
    const order: string[] = [];
    s.setData.mockImplementation((d: unknown[]) => order.push(`rsi:${d.length}`));
    r.renderAround(candles(300, 1000), 14, () => order.push('price')); // e.g. a timeframe switch
    expect(order).toEqual(['rsi:0', 'price', 'rsi:160']);
  });

  it('keeps RSI data during a prepend and renders it after the price series', () => {
    const { created, api } = fakeChart();
    const r = new RsiPaneRenderer();
    const current = candles(200, 500);
    r.attach(api, current, 14);
    const s = created[0].series;
    const order: string[] = [];
    s.setData.mockImplementation((d: unknown[]) => order.push(`rsi:${d.length}`));
    r.renderAround([...candles(100, 400), ...current], 14, () => order.push('price'));
    expect(order).toEqual(['price', 'rsi:160']);
  });
});

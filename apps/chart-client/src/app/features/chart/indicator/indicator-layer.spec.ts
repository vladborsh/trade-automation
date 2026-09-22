import { vi } from 'vitest';
import { HistogramSeries, LineSeries, type IChartApi } from 'lightweight-charts';
import type { IndicatorPoint, IndicatorSeriesSpec } from '@trade-automation/contracts';
import { IndicatorLayer } from './indicator-layer';

/** A fake lightweight-charts chart: panes are arrays of fake series; empty panes are kept (LWC may or may not drop them). */
function fakeChart() {
  const panes: FakeSeries[][] = [[]];
  const addCalls: unknown[][] = [];
  class FakeSeries {
    opts: Record<string, unknown>;
    data: unknown[] = [];
    lines: unknown[] = [];
    constructor(opts: Record<string, unknown>) {
      this.opts = { visible: true, ...opts };
    }
    applyOptions(o: Record<string, unknown>) {
      Object.assign(this.opts, o);
    }
    options() {
      return this.opts;
    }
    setData(d: unknown[]) {
      this.data = d;
    }
    createPriceLine(o: unknown) {
      this.lines.push(o);
      return o;
    }
    getPane() {
      const idx = panes.findIndex((p) => p.includes(this));
      return { paneIndex: () => idx, getSeries: () => panes[idx] };
    }
  }
  const chart = {
    addSeries: vi.fn((...args: unknown[]) => {
      addCalls.push(args);
      const s = new FakeSeries(args[1] as Record<string, unknown>);
      const idx = (args[2] as number | undefined) ?? 0;
      while (panes.length <= idx) panes.push([]);
      panes[idx].push(s);
      return s;
    }),
    removeSeries: vi.fn((s: FakeSeries) => {
      for (const p of panes) {
        const i = p.indexOf(s);
        if (i >= 0) p.splice(i, 1);
      }
    }),
    panes: () => panes.map((p, i) => ({ paneIndex: () => i, getSeries: () => p })),
    removePane: vi.fn((i: number) => void panes.splice(i, 1)),
  };
  return { chart: chart as unknown as IChartApi, raw: chart, panes, addCalls };
}

const point = (seriesId: string, time: number, values: Record<string, number | null>, timeframe: IndicatorPoint['timeframe'] = '5m'): IndicatorPoint => ({
  strategyId: 'replay', instrument: 'binance:BTCUSDT', timeframe, tier: 'live', seriesId, time, values,
});

const VWAP: IndicatorSeriesSpec = { id: 'vwap', label: 'VWAP', scale: 'price', keys: [{ key: 'vwap', label: 'VWAP', color: '#d29922' }, { key: 'top', label: 'Top', style: 'dashed' }] };
const RSI: IndicatorSeriesSpec = { id: 'rsi-0', label: 'RSI (14)', scale: 'pane', range: { min: 0, max: 100 }, levels: [30, 70], keys: [{ key: 'rsi', label: 'RSI' }] };
const MACD: IndicatorSeriesSpec = { id: 'macd-1', label: 'MACD', scale: 'pane', levels: [0], keys: [{ key: 'macd', label: 'MACD' }, { key: 'signal', label: 'Signal' }] };

describe('IndicatorLayer', () => {
  describe("price specs (the live terminal's path) are unchanged", () => {
    it('are added on the price pane with the original options, and hidden (not removed) when inactive', () => {
      const { chart, raw, addCalls, panes } = fakeChart();
      const layer = new IndicatorLayer();
      layer.attach(chart);
      const specs = new Map([['s1:vwap', VWAP]]);
      layer.render([point('vwap', 1_000_000, { vwap: 10, top: 11 })].map((p) => ({ ...p, strategyId: 's1' })), specs, '5m');
      expect(addCalls).toEqual([
        [LineSeries, { color: '#d29922', lineWidth: 1, lineStyle: 0, title: 'VWAP · VWAP', lastValueVisible: false, priceLineVisible: false }],
        [LineSeries, { color: '#d29922', lineWidth: 1, lineStyle: 2, title: 'VWAP · Top', lastValueVisible: false, priceLineVisible: false }],
      ]);
      expect(addCalls.every((c) => c.length === 2)).toBe(true); // no pane index
      expect(panes).toHaveLength(1);
      expect(layer.visibleSeriesCount()).toBe(2);

      layer.render([], specs, '5m');
      expect(raw.removeSeries).not.toHaveBeenCalled();
      expect(layer.visibleSeriesCount()).toBe(0);
      // a timeframe mismatch hides them too, as before
      layer.render([{ ...point('vwap', 1, { vwap: 1, top: 1 }, '1h'), strategyId: 's1' }], specs, '5m');
      expect(layer.visibleSeriesCount()).toBe(0);
      expect(raw.removePane).not.toHaveBeenCalled();
    });
  });

  describe("'pane' specs (T-028)", () => {
    it('get their own pane each, with levels and a fixed range', () => {
      const { chart, addCalls, panes } = fakeChart();
      const layer = new IndicatorLayer();
      layer.attach(chart);
      const specs = new Map([['replay:rsi-0', RSI], ['replay:macd-1', MACD]]);
      layer.render(
        [point('rsi-0', 60_000, { rsi: 55 }), point('rsi-0', 120_000, { rsi: null }), point('macd-1', 60_000, { macd: 1, signal: 0.5 })],
        specs,
        '5m',
      );
      expect(addCalls.map((c) => c[2])).toEqual([1, 2, 2]); // RSI in pane 1, MACD's two lines in pane 2
      expect(panes.map((p) => p.length)).toEqual([0, 1, 2]);
      const rsi = panes[1][0] as unknown as { data: unknown[]; lines: { price: number }[]; opts: { autoscaleInfoProvider: () => unknown } };
      expect(rsi.data).toEqual([{ time: 60, value: 55 }]); // null values are gaps
      expect(rsi.lines.map((l) => l.price)).toEqual([30, 70]);
      expect(rsi.opts.autoscaleInfoProvider()).toEqual({ priceRange: { minValue: 0, maxValue: 100 } });
      expect(layer.paneCount()).toBe(2);
      expect(layer.visibleSeriesCount()).toBe(3);
    });

    it('updates data in place on re-render, and removes an emptied pane when the indicator goes', () => {
      const { chart, raw, panes } = fakeChart();
      const layer = new IndicatorLayer();
      layer.attach(chart);
      const specs = new Map([['replay:rsi-0', RSI], ['replay:macd-1', MACD]]);
      const both = [point('rsi-0', 60_000, { rsi: 55 }), point('macd-1', 60_000, { macd: 1, signal: 0.5 })];
      layer.render(both, specs, '5m');
      layer.render([...both, point('rsi-0', 120_000, { rsi: 60 })], specs, '5m');
      expect(raw.addSeries).toHaveBeenCalledTimes(3); // no new series for new data
      expect((panes[1][0] as unknown as { data: unknown[] }).data).toHaveLength(2);

      layer.render([point('macd-1', 60_000, { macd: 1, signal: 0.5 })], specs, '5m'); // RSI removed
      expect(raw.removeSeries).toHaveBeenCalledTimes(1);
      expect(raw.removePane).toHaveBeenCalledWith(1);
      expect(panes.map((p) => p.length)).toEqual([0, 2]); // MACD moved up into pane 1
      expect(layer.paneCount()).toBe(1);

      layer.clearAll();
      expect(panes.map((p) => p.length)).toEqual([0]);
      expect(layer.paneCount()).toBe(0);
    });

    it('does not remove a pane lightweight-charts already dropped by itself', () => {
      const { chart, raw, panes } = fakeChart();
      raw.removeSeries.mockImplementation((s: unknown) => {
        const i = panes.findIndex((p) => p.includes(s as never));
        panes[i].splice(panes[i].indexOf(s as never), 1);
        if (i > 0 && panes[i].length === 0) panes.splice(i, 1); // LWC's own empty-pane removal
      });
      const layer = new IndicatorLayer();
      layer.attach(chart);
      const specs = new Map([['replay:rsi-0', RSI]]);
      layer.render([point('rsi-0', 60_000, { rsi: 55 })], specs, '5m');
      layer.render([], specs, '5m');
      expect(raw.removePane).not.toHaveBeenCalled();
      expect(panes).toHaveLength(1);
    });
  });

  describe('T-047: labels', () => {
    const render = (layer: IndicatorLayer) =>
      layer.render(
        [point('vwap', 60_000, { vwap: 100, top: 101 }), point('rsi-0', 60_000, { rsi: 55 }), point('macd-1', 60_000, { macd: 1, signal: 0.5 })],
        new Map([['replay:vwap', VWAP], ['replay:rsi-0', RSI], ['replay:macd-1', MACD]]),
        '5m',
      );
    const options = (addCalls: unknown[][]) => addCalls.map((c) => c[1] as { title: string; lastValueVisible: boolean; priceLineVisible: boolean });

    it('off (replay panels): lines only — no title on any series, price-pane or own-pane; no value labels, no price lines', () => {
      const { chart, addCalls, panes } = fakeChart();
      const layer = new IndicatorLayer(() => false);
      layer.attach(chart);
      render(layer);
      expect(options(addCalls).map((o) => o.title)).toEqual(['', '', '', '', '']);
      expect(options(addCalls).every((o) => o.lastValueVisible === false && o.priceLineVisible === false)).toBe(true);
      const levels = (panes[1][0] as unknown as { lines: { axisLabelVisible: boolean; title: string }[] }).lines;
      expect(levels.every((l) => l.axisLabelVisible === false && l.title === '')).toBe(true); // the RSI 30/70 guides are unlabelled too
      expect(layer.visibleSeriesCount()).toBe(5); // every line is still drawn
    });

    it('on by default (the live terminal): each series keeps "<indicator> · <line>"', () => {
      const { chart, addCalls } = fakeChart();
      const layer = new IndicatorLayer();
      layer.attach(chart);
      render(layer);
      expect(options(addCalls).map((o) => o.title)).toEqual(['VWAP · VWAP', 'VWAP · Top', 'RSI (14) · RSI', 'MACD · MACD', 'MACD · Signal']);
    });
  });

  describe("T-057: a key's plot", () => {
    const MACD_HIST: IndicatorSeriesSpec = { ...MACD, keys: [...MACD.keys, { key: 'hist', label: 'Histogram', color: '#bc8cff', plot: 'histogram' }] };
    const pts = [point('macd-1', 60_000, { macd: 1, signal: 0.5, hist: 0.5 }), point('macd-1', 120_000, { macd: 0.2, signal: 0.6, hist: -0.4 }), point('macd-1', 180_000, { macd: 0.6, signal: 0.6, hist: 0 })];

    it("'histogram' is a HistogramSeries in the indicator's own pane, bars coloured by sign (0 counts as up); the lines stay lines", () => {
      const { chart, addCalls, panes } = fakeChart();
      const layer = new IndicatorLayer(() => false);
      layer.attach(chart);
      layer.render(pts, new Map([['replay:macd-1', MACD_HIST]]), '5m');
      expect(addCalls.map((c) => [c[0], c[2]])).toEqual([[LineSeries, 1], [LineSeries, 1], [HistogramSeries, 1]]);
      expect(addCalls[2][1]).toEqual({ title: '', lastValueVisible: false, priceLineVisible: false }); // no line options on a histogram
      const hist = panes[1][2] as unknown as { data: unknown[] };
      expect(hist.data).toEqual([
        { time: 60, value: 0.5, color: '#26a69a' },
        { time: 120, value: -0.4, color: '#ef5350' },
        { time: 180, value: 0, color: '#26a69a' },
      ]);
      const macdLine = panes[1][0] as unknown as { data: unknown[] };
      expect(macdLine.data).toEqual([{ time: 60, value: 1 }, { time: 120, value: 0.2 }, { time: 180, value: 0.6 }]); // no colour on line points
      expect(layer.visibleSeriesCount()).toBe(3);
    });

    it("'histogram' on a price-scale spec goes on the price pane (no pane argument); 'line' and an absent plot are lines", () => {
      const { chart, addCalls } = fakeChart();
      const layer = new IndicatorLayer();
      layer.attach(chart);
      const spec: IndicatorSeriesSpec = { id: 'x', label: 'X', scale: 'price', keys: [{ key: 'a', label: 'A', plot: 'line' }, { key: 'b', label: 'B' }, { key: 'h', label: 'H', plot: 'histogram' }] };
      layer.render([point('x', 60_000, { a: 1, b: 2, h: -1 })], new Map([['replay:x', spec]]), '5m');
      expect(addCalls.map((c) => [c[0], c.length])).toEqual([[LineSeries, 2], [LineSeries, 2], [HistogramSeries, 2]]);
    });
  });
});

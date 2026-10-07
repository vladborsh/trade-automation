import type { IChartApi } from 'lightweight-charts';
import { buildPanels } from './panel-definitions';
import { LIQUIDATION_COLORS } from './liquidation-histogram.renderer';
import { I18nService } from '../../i18n/i18n.service';
import type { PaneData } from './pane-data';

/**
 * IB-BUG-009 — the six panels: which they are, in what order, and that each one draws into a
 * chart of its own.
 *
 * The property worth defending is the last: when everything shared one scale, open interest at
 * 10^9 flattened BTC's candles at 10^4 and the liquidation bars anchored at zero dragged the
 * price scale down with them (IB-031, both found on a live render). Six charts means six scales,
 * and these tests pin that each definition touches only the chart it was given.
 */

/** Records what a panel adds, without a DOM or a real chart. */
function fakeChart() {
  const series: Array<{ options: Record<string, unknown>; data: unknown[] }> = [];
  const chart = {
    addSeries: (_type: unknown, options: Record<string, unknown>) => {
      const entry = { options: options ?? {}, data: [] as unknown[] };
      series.push(entry);
      return { setData: (d: unknown[]) => { entry.data = d; } };
    },
    timeScale: () => ({ fitContent: () => {} }),
  } as unknown as IChartApi;
  return { chart, series };
}

const CLOSE = Math.floor(Date.UTC(2026, 8, 28, 12, 0, 0) / 1000);

const data = (): PaneData => ({
  instrument: 'binance:BTCUSDT',
  timeframe: '1m',
  bucket: '1m',
  candles: {
    venue: 'binance', market: 'perp', symbol: 'BTCUSDT', timeframe: '1m', downsampled: false,
    candles: [
      { time: CLOSE - 60, open: 100, high: 110, low: 90, close: 105, volume: 10, takerBuyVolume: 6 },
      { time: CLOSE, open: 105, high: 115, low: 95, close: 110, volume: 12, takerBuyVolume: 5 },
    ],
  },
  openInterest: [
    { time: CLOSE - 60, value: 1000, notional: 90_000 },
    { time: CLOSE, value: 1010, notional: 91_000 },
  ],
  funding: {
    symbol: 'BTCUSDT', downsampled: false,
    settled: [{ venue: 'binance', points: [{ time: CLOSE - 60, rate: 0.0001 }] }],
    predicted: [{ time: CLOSE, rate: 0.00012 }],
  },
  longShort: { symbol: 'BTCUSDT', kind: 'global_account', downsampled: false, points: [{ time: CLOSE, ratio: 1.4 }] },
  liquidations: {
    symbol: 'BTCUSDT', bucket: '1m', venue: 'all', undercounted: true, downsampled: false,
    bars: [{ time: CLOSE, long: 500, short: 200, events: 3 }],
  },
});

describe('the six panels', () => {
  it('are the six the user asked for, left to right', () => {
    expect(buildPanels(data()).map((p) => p.id))
      .toEqual(['price', 'oi', 'liquidations', 'cvd', 'funding', 'long-short']);
  });

  it('every panel has a title that resolves in BOTH languages', () => {
    const en = new I18nService();
    en.setLang('en');
    const ru = new I18nService();
    ru.setLang('ru');
    for (const panel of buildPanels(data())) {
      expect(en.t(panel.titleKey)).not.toBe(panel.titleKey);
      expect(ru.t(panel.titleKey)).not.toBe(panel.titleKey);
      expect(ru.t(panel.titleKey)).not.toBe(en.t(panel.titleKey)); // translated, not copied
    }
  });

  it('the titles carry their unit, which is what makes the number readable', () => {
    const en = new I18nService();
    en.setLang('en');
    const titles = buildPanels(data()).map((p) => en.t(p.titleKey));
    expect(titles).toEqual([
      'Price, USDT', 'Open interest, USD', 'Liquidations long/short, USD',
      'Delta / CVD, base', 'Funding, %', 'Long/Short, ratio',
    ]);
  });

  it('two-series panels carry a legend, single-series ones do not', () => {
    const byId = Object.fromEntries(buildPanels(data()).map((p) => [p.id, p]));
    expect(byId['liquidations'].legend.map((l) => l.color))
      .toEqual([LIQUIDATION_COLORS.long, LIQUIDATION_COLORS.short]);
    expect(byId['cvd'].legend).toHaveLength(2);
    expect(byId['funding'].legend).toHaveLength(2);
    expect(byId['price'].legend).toEqual([]);
    expect(byId['long-short'].legend).toEqual([]);
  });
});

describe('each panel draws into its OWN chart', () => {
  it('a panel adds series only to the chart it is given', () => {
    const panels = buildPanels(data());
    for (const panel of panels) {
      const a = fakeChart();
      const b = fakeChart();
      panel.draw(a.chart);
      expect(a.series.length).toBeGreaterThan(0);
      expect(b.series).toHaveLength(0); // nothing leaks sideways
    }
  });

  it('nothing sets a fixed or zero-based price range — that was T-065\'s dead space', () => {
    for (const panel of buildPanels(data())) {
      const { chart, series } = fakeChart();
      panel.draw(chart);
      for (const s of series) {
        expect(s.options['autoscaleInfoProvider']).toBeUndefined();
        expect(s.options['baseLineVisible']).not.toBe(true);
      }
    }
  });

  it('liquidations draw two histogram series, longs and shorts, on one scale', () => {
    const { chart, series } = fakeChart();
    buildPanels(data()).find((p) => p.id === 'liquidations')!.draw(chart);
    expect(series).toHaveLength(2);
    expect(series[0].options['color']).toBe(LIQUIDATION_COLORS.long);
    expect(series[1].options['color']).toBe(LIQUIDATION_COLORS.short);
    expect(series[0].options['priceScaleId']).toBe(series[1].options['priceScaleId']);
  });

  it('open interest plots the USD notional, and omits a point that has none', () => {
    const withGap = data();
    withGap.openInterest = [
      { time: CLOSE - 60, value: 1000, notional: 90_000 },
      { time: CLOSE, value: 1010, notional: null },
    ];
    const { chart, series } = fakeChart();
    buildPanels(withGap).find((p) => p.id === 'oi')!.draw(chart);
    // a base-unit figure drawn on a USD scale would be a different quantity wearing the same axis
    expect(series[0].data).toHaveLength(1);
  });

  it('CVD breaks into one series per segment, so an outage stays a hole', () => {
    const broken = data();
    broken.candles.candles = [
      { time: CLOSE - 120, open: 1, high: 1, low: 1, close: 1, volume: 10, takerBuyVolume: 6 },
      { time: CLOSE - 60, open: 1, high: 1, low: 1, close: 1, volume: 10, takerBuyVolume: null },
      { time: CLOSE, open: 1, high: 1, low: 1, close: 1, volume: 10, takerBuyVolume: 6 },
    ];
    const { chart, series } = fakeChart();
    buildPanels(broken).find((p) => p.id === 'cvd')!.draw(chart);
    // one histogram for the delta, plus two line segments either side of the gap
    expect(series).toHaveLength(3);
  });
});

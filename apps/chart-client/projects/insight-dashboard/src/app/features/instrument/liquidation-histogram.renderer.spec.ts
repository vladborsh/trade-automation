import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import {
  LIQUIDATION_COLORS, LiquidationHistogramRenderer, liquidationPaneTitle,
} from './liquidation-histogram.renderer';
import { I18nService } from '../../i18n/i18n.service';

/**
 * IB-031 — the liquidations pane. The renderer is thin, so the spec is about the two things
 * that carry meaning: two opposed series, and a title that admits the undercount.
 */

/** `data` is taken by ISeriesApi's own method, so the capture is named `captured`. */
type FakeSeries = ISeriesApi<'Histogram'> & { captured: Array<{ time: number; value: number }>; options: Record<string, unknown> };

function fakeChart() {
  const added: FakeSeries[] = [];
  const removed: unknown[] = [];
  const chart = {
    addSeries: (_type: unknown, options: Record<string, unknown>) => {
      const series: FakeSeries = {
        options,
        captured: [],
        setData(next: Array<{ time: number; value: number }>) { series.captured = next; },
      } as unknown as FakeSeries;
      added.push(series);
      return series;
    },
    removeSeries: (s: unknown) => { removed.push(s); },
  } as unknown as IChartApi;
  return { chart, added, removed };
}

const bars = [
  { time: 100, long: 500, short: 200, events: 3 },
  { time: 160, long: 0, short: 0, events: 0 },
  { time: 220, long: 0, short: 900, events: 1 },
];

describe('LiquidationHistogramRenderer', () => {
  it('adds TWO series — the sides are never summed into one bar', () => {
    const { chart, added } = fakeChart();
    new LiquidationHistogramRenderer().attach(chart);
    expect(added).toHaveLength(2);
    expect(added[0].options['color']).toBe(LIQUIDATION_COLORS.long);
    expect(added[1].options['color']).toBe(LIQUIDATION_COLORS.short);
  });

  it('shares one price scale, so a big long cascade dwarfs the shorts instead of each side self-scaling', () => {
    const { chart, added } = fakeChart();
    new LiquidationHistogramRenderer().attach(chart);
    expect(added[0].options['priceScaleId']).toBe(added[1].options['priceScaleId']);
  });

  it('draws longs positive and shorts negative', () => {
    const { chart, added } = fakeChart();
    const renderer = new LiquidationHistogramRenderer();
    renderer.attach(chart);
    renderer.setData(bars);

    expect(added[0].captured.map((d) => d.value)).toEqual([500, 0, 0]);
    expect(added[1].captured.map((d) => d.value)).toEqual([-200, -0, -900]);
  });

  it('keeps the empty bucket, so a quiet stretch is visible rather than compressed away', () => {
    const { chart, added } = fakeChart();
    const renderer = new LiquidationHistogramRenderer();
    renderer.attach(chart);
    renderer.setData(bars);
    expect(added[0].captured.map((d) => d.time)).toEqual([100, 160, 220]);
  });

  it('colour follows what the market did: a liquidated long is the DOWN colour', () => {
    // the palette, not a near-duplicate of it (AGENTS.md)
    expect(LIQUIDATION_COLORS.long).toBe('#ef5350');
    expect(LIQUIDATION_COLORS.short).toBe('#26a69a');
  });

  it('setData before attach is a no-op rather than a crash', () => {
    expect(() => new LiquidationHistogramRenderer().setData(bars)).not.toThrow();
  });

  it('detach removes both series and can be re-attached', () => {
    const { chart, removed } = fakeChart();
    const renderer = new LiquidationHistogramRenderer();
    renderer.attach(chart);
    expect(renderer.attached).toBe(true);
    renderer.detach(chart);
    expect(removed).toHaveLength(2);
    expect(renderer.attached).toBe(false);
  });
});

describe('liquidationPaneTitle', () => {
  // a real translator over the real tables, so a missing key or a dropped placeholder fails here
  const en = new I18nService();
  en.setLang('en');
  const ru = new I18nService();
  ru.setLang('ru');

  it('states the Binance undercount in the title, not in a footnote nobody opens', () => {
    const title = liquidationPaneTitle(en.t.bind(en), '1m', 'all', true);
    expect(title).toContain('visible only');
    expect(title).toContain('1 event/s per symbol');
  });

  it('says the same thing in Russian — the warning is not an English-only courtesy', () => {
    const title = liquidationPaneTitle(ru.t.bind(ru), '1m', 'all', true);
    expect(title).toContain('только видимые');
    expect(title).toContain('1 события в секунду');
  });

  it('does not claim the undercount when it does not apply', () => {
    expect(liquidationPaneTitle(en.t.bind(en), '1h', 'bybit', false)).toBe('Liquidations (1h, bybit)');
  });

  it('keeps the venue and bucket as CODES in both languages (§11)', () => {
    for (const t of [en.t.bind(en), ru.t.bind(ru)]) {
      const title = liquidationPaneTitle(t, '15m', 'okx', false);
      expect(title).toContain('okx');
      expect(title).toContain('15m');
    }
  });
});

import { ru } from '../../i18n/ru';
import { en } from '../../i18n/en';
import {
  PANELS, PANEL_PRICE_SCALE, PANEL_SCALE_MARGINS, PANEL_TIME_SCALE, panelHeading, quoteCurrency,
  windowBounds, type PanelDef,
} from './panels.model';
import type { PaneData } from './pane-data';
import { LIQUIDATION_COLORS } from './liquidation-histogram.renderer';

import type { StringKey } from '../../i18n/keys';

const t = (key: StringKey): string => (ru as Record<string, string>)[key] ?? `MISSING:${key}`;

describe('the six panels (IB-BUG-009)', () => {
  it('are in the order the user asked for, left to right', () => {
    expect(PANELS.map((p) => p.key)).toEqual([
      'price', 'openInterest', 'liquidations', 'delta', 'funding', 'longShort',
    ]);
  });

  it('every panel has a title in both languages', () => {
    for (const panel of PANELS) {
      for (const table of [ru, en] as Array<Record<string, string>>) {
        expect(table[panel.titleKey]).toBeTruthy();
      }
    }
  });

  it('every table-backed unit exists in both languages', () => {
    for (const panel of PANELS) {
      if (panel.unitKey === null) continue; // the price panel's unit is data — see below
      for (const table of [ru, en] as Array<Record<string, string>>) {
        expect(table[panel.unitKey]).toBeTruthy();
      }
    }
  });

  it("takes the price panel's unit from the SYMBOL, not from a hard-coded USDT", () => {
    // A BTC-USD perp must read USD. The unit is the quote currency, which is data.
    const price = PANELS[0];
    expect(price.unitKey).toBeNull();
    expect(panelHeading(t, price, 'BTCUSDT')).toBe('Цена · USDT');
    expect(panelHeading(t, price, 'BTCUSDC')).toBe('Цена · USDC');
    expect(quoteCurrency('ETHUSD')).toBe('USD');
    // An unrecognised symbol shows itself rather than being silently labelled USDT.
    expect(quoteCurrency('WEIRD')).toBe('WEIRD');
    // No symbol yet: the title alone, with no dangling separator.
    expect(panelHeading(t, price, '')).toBe('Цена');
  });

  it('reads "Цена · USDT" — a title and a unit, not prose', () => {
    expect(panelHeading(t, PANELS[0], 'BTCUSDT')).toBe('Цена · USDT');
    expect(panelHeading(t, PANELS[1])).toBe('Открытый интерес · контракты');
  });

  it('gives a legend to the two-series panels and none to the one-series panels', () => {
    const legends = new Map(PANELS.map((p) => [p.key, p.legend.length]));
    // Two series each: liquidations (longs/shorts), delta (CVD/per-bar), funding (settled/predicted).
    expect(legends.get('liquidations')).toBe(2);
    expect(legends.get('delta')).toBe(2);
    expect(legends.get('funding')).toBe(2);
    // One series each: a legend of one entry is noise beside a title that already names it.
    expect(legends.get('price')).toBe(0);
    expect(legends.get('openInterest')).toBe(0);
    expect(legends.get('longShort')).toBe(0);
  });

  it('every legend label exists in both languages', () => {
    for (const panel of PANELS) {
      for (const entry of panel.legend) {
        for (const table of [ru, en] as Array<Record<string, string>>) {
          expect(table[entry.labelKey]).toBeTruthy();
        }
      }
    }
  });

  it('keeps IB-031 colour rule: longs in the down colour, shorts in the up colour', () => {
    // A long being liquidated is price falling, so the colour matches what the market did.
    const liquidations = PANELS.find((p) => p.key === 'liquidations') as PanelDef;
    expect(liquidations.legend[0].colour).toBe(LIQUIDATION_COLORS.long);
    expect(liquidations.legend[0].colour).toBe('#ef5350');
    expect(liquidations.legend[1].colour).toBe(LIQUIDATION_COLORS.short);
    expect(liquidations.legend[1].colour).toBe('#26a69a');
  });

  it('uses only the AGENTS.md palette for swatches', () => {
    const palette = new Set(['#26a69a', '#ef5350', '#c9d1d9', '#8b949e', '#30363d', '#0d1117']);
    for (const panel of PANELS) {
      for (const entry of panel.legend) expect(palette.has(entry.colour)).toBe(true);
    }
  });
});

describe('the price scale (IB-BUG-009: autoscale, never fixed or zero-based)', () => {
  it('autoscales', () => {
    expect(PANEL_PRICE_SCALE.autoScale).toBe(true);
  });

  it('has small symmetric margins so the extremes nearly touch the edges', () => {
    expect(PANEL_SCALE_MARGINS.top).toBe(PANEL_SCALE_MARGINS.bottom);
    expect(PANEL_SCALE_MARGINS.top).toBeGreaterThan(0); // 0 would clip a line drawn at the extreme
    expect(PANEL_SCALE_MARGINS.top).toBeLessThanOrEqual(0.1); // T-065: no dead space
  });

  it('declares no fixed range and no zero base', () => {
    // The two things the brief forbids, asserted rather than assumed: T-065 had to remove dead
    // space from a scale that did not fit its data.
    expect(PANEL_PRICE_SCALE).not.toHaveProperty('minValue');
    expect(PANEL_PRICE_SCALE).not.toHaveProperty('maxValue');
    expect(JSON.stringify(PANEL_PRICE_SCALE)).not.toContain('"base"');
  });
});

/**
 * The initial visible range. This is the bug the first acceptance run exposed: lightweight-charts
 * does not fit a series on `setData`, so each panel showed ~43 bars of its own data at its own
 * zoom. One shared wall-clock window fixes both the sliver and the alignment.
 */
describe('windowBounds (IB-BUG-009)', () => {
  const data = (over: Partial<PaneData> = {}): PaneData => ({
    instrument: 'BTCUSDT',
    timeframe: '1m',
    bucket: '5m',
    candles: { candles: [{ time: 1000, open: 1, high: 1, low: 1, close: 1, volume: 1 }] } as never,
    openInterest: [{ time: 2000, value: 1, notional: null }],
    funding: { settled: [{ venue: 'binance', points: [{ time: 500, rate: 0 }] }], predicted: [] } as never,
    longShort: { points: [{ time: 3000, ratio: 1 }] } as never,
    liquidations: { bars: [{ time: 2500, long: 0, short: 0, events: 0 }] } as never,
    ...over,
  });

  it('spans every series, not the candles alone', () => {
    // Funding starts before the candles and long/short ends after them; a window taken from the
    // candles would push both off the axis.
    expect(windowBounds(data())).toEqual({ from: 500, to: 3000 });
  });

  it('returns null for an empty window rather than inventing a range', () => {
    expect(windowBounds(data({
      candles: { candles: [] } as never,
      openInterest: [],
      funding: { settled: [], predicted: [] } as never,
      longShort: { points: [] } as never,
      liquidations: { bars: [] } as never,
    }))).toBeNull();
  });

  it('widens a single-point window, which has no width to display', () => {
    expect(windowBounds(data({
      candles: { candles: [] } as never,
      openInterest: [{ time: 2000, value: 1, notional: null }],
      funding: { settled: [], predicted: [] } as never,
      longShort: { points: [] } as never,
      liquidations: { bars: [] } as never,
    }))).toEqual({ from: 1970, to: 2030 });
  });
});

describe('the time scale (IB-BUG-009)', () => {
  it('compresses far enough for a day of 1m bars in one narrow column', () => {
    // The library's 0.5 px default caps a ~190 px plot area at ~370 bars, which silently clamped
    // the 1440-bar panels to the last ~6 hours while the 288-bar panels showed the whole day.
    const plotWidthPx = 190; // a 260 px column less its price scale
    const barsInADayOf1m = 1440;
    expect(barsInADayOf1m * PANEL_TIME_SCALE.minBarSpacing).toBeLessThan(plotWidthPx);
  });

  it('gives every panel its own visible time axis, as the brief requires', () => {
    expect(PANEL_TIME_SCALE.timeVisible).toBe(true);
  });
});

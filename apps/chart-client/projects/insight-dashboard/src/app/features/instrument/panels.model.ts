import type { StringKey } from '../../i18n/keys';
import type { PaneData } from './pane-data';
import { LIQUIDATION_COLORS } from './liquidation-scope';

/**
 * IB-BUG-009 — the six panels of the instrument row, as data (user feedback 2026-10-07,
 * `reports/zinc-raven-instrument-layout.md`).
 *
 * **This replaces one chart of six stacked panes with six charts in a row**, which reverses the
 * reasoning IB-031 wrote into `instrument-chart.component.ts`: *"One chart with panes, not
 * several charts. Every pane shares the chart's time scale, which is what time-aligned means."*
 * That argument was sound and the user has overruled it, so the cost is named here rather than
 * lost: **six charts have six independent time scales, so panning or zooming one no longer moves
 * the others.** The brief makes cross-panel sync a bonus; see `instrument-chart.component.ts`
 * for what was actually done about it.
 *
 * Keeping the list as data rather than six blocks of template does two things: the row's
 * component stays well under AGENTS.md's 250-line ceiling, and the titles, units and legends —
 * the part a reader checks — are spec'd without rendering a chart.
 */

/** A legend entry under a panel's title: a swatch and a translated word. */
export interface PanelLegendEntry {
  colour: string;
  labelKey: StringKey;
}

export interface PanelDef {
  /** Stable key, used for `track` and for the panel's test hook. */
  key: 'price' | 'openInterest' | 'delta' | 'funding' | 'longShort';
  titleKey: StringKey;
  /**
   * Shown after the title, e.g. "Открытый интерес · контракты". A unit, not prose.
   * `null` on the price panel, whose unit is the instrument's quote currency (data, not a
   * string table entry).
   */
  unitKey: StringKey | null;
  /**
   * Two-series panels get a legend; one-series panels do not, because a legend of one entry is
   * noise next to a title that already says what the series is.
   */
  legend: readonly PanelLegendEntry[];
}

const GREY = '#8b949e';
const TEXT = '#c9d1d9';
const UP = '#26a69a';

/**
 * Left to right: Price | OI | CVD/delta | Funding | L/S.
 *
 * **Five, not six.** IB-039 removed the liquidations column (§12.5): liquidations are events at
 * a price, not a series beside the price, so they are drawn as bubbles ON the price panel and
 * summarised underneath. The price panel's legend carries their colours now — see
 * `liquidation-scope.ts`, which still owns the rule that a liquidated long is the DOWN colour.
 */
export const PANELS: readonly PanelDef[] = [
  // The price panel's unit is the instrument's QUOTE CURRENCY, which is data, not a translated
  // string: a BTC-USD perp must read "USD", not a hard-coded "USDT". `unitKey: null` means
  // "resolve it from the symbol" — see `panelUnit`.
  // The price panel's legend is the MARKERS' legend: the bubbles drawn over it are the only
  // thing on this chart with two colours, and an unexplained red and green circle is a puzzle.
  {
    key: 'price',
    titleKey: 'instrument.panel.price',
    unitKey: null,
    legend: [
      { colour: LIQUIDATION_COLORS.long, labelKey: 'instrument.legend.longs' },
      { colour: LIQUIDATION_COLORS.short, labelKey: 'instrument.legend.shorts' },
    ],
  },
  {
    key: 'openInterest',
    titleKey: 'instrument.panel.openInterest',
    unitKey: 'instrument.unit.contracts',
    legend: [],
  },
  {
    key: 'delta',
    titleKey: 'instrument.panel.delta',
    unitKey: 'instrument.unit.usd',
    legend: [
      { colour: GREY, labelKey: 'instrument.legend.cvd' },
      { colour: TEXT, labelKey: 'instrument.legend.delta' },
    ],
  },
  {
    key: 'funding',
    titleKey: 'instrument.panel.funding',
    unitKey: 'instrument.unit.percent',
    legend: [
      { colour: UP, labelKey: 'instrument.legend.settled' },
      { colour: GREY, labelKey: 'instrument.legend.predicted' },
    ],
  },
  {
    key: 'longShort',
    titleKey: 'instrument.panel.longShort',
    unitKey: 'instrument.unit.ratio',
    legend: [],
  },
];

/**
 * Price-scale margins for every panel, as a fraction of its height.
 *
 * Small and symmetric, so the highest and lowest visible points nearly touch the edges — which
 * is the point of the change. **Not zero-based and not fixed:** T-065 had to remove dead space
 * caused by a scale that did not fit its data, and a `scaleMargins` of 0 would clip a line
 * drawn exactly at the extreme, so 6 % is the smallest margin that keeps a peak visible.
 *
 * The liquidation panel's bars are anchored at zero, which used to drag the *shared* price scale
 * and squash the candles (IB-031 found that on its acceptance run). In a row each panel owns its
 * scale, so zero-anchored bars now only shape their own panel — which is correct for bars — and
 * cannot reach the price panel at all. That is the specific thing the brief asked me to check.
 */
export const PANEL_SCALE_MARGINS = { top: 0.06, bottom: 0.06 } as const;

/** Autoscale fits the visible range, so the scale re-fits on every scroll and zoom. */
export const PANEL_PRICE_SCALE = {
  autoScale: true,
  borderColor: '#30363d',
  scaleMargins: PANEL_SCALE_MARGINS,
} as const;

/**
 * Time-scale options shared by every panel.
 *
 * **`minBarSpacing` is the whole reason this constant exists.** lightweight-charts refuses to
 * compress bars below 0.5 px by default, so a column whose plot area is ~190 px wide can show at
 * most ~370 bars however you set its visible range. A 1-day window of 1m candles is ~1440 bars,
 * and the second acceptance run showed exactly that arithmetic: the 1440-bar panels (price,
 * CVD/delta, liquidations) silently clamped to the most recent ~6 hours while the ~288-bar panels
 * (open interest, long/short) showed the full day — six panels, two different windows, no error
 * anywhere. 0.05 px lets ~3800 bars into the same column, which covers every window the server
 * serves (it downsamples beyond that).
 *
 * `timeVisible` with `secondsVisible: false` keeps each panel's own axis readable at this width.
 */
export const PANEL_TIME_SCALE = {
  borderColor: '#30363d',
  timeVisible: true,
  secondsVisible: false,
  minBarSpacing: 0.05,
} as const;

/**
 * The quote currency of a Binance-style symbol: `BTCUSDT` → `USDT`, `BTCUSDC` → `USDC`.
 * Falls back to the whole symbol rather than guessing, so an unrecognised one is visible instead
 * of being silently labelled USDT.
 */
export function quoteCurrency(symbol: string): string {
  for (const quote of ['USDT', 'USDC', 'USD', 'BTC', 'ETH', 'EUR', 'TRY']) {
    if (symbol.toUpperCase().endsWith(quote)) return quote;
  }
  return symbol.toUpperCase();
}

/** `Цена · USDT` — a title and its unit, joined once so every panel reads the same. */
export function panelHeading(t: (key: StringKey) => string, panel: PanelDef, symbol = ''): string {
  const unit = panel.unitKey === null ? quoteCurrency(symbol) : t(panel.unitKey);
  return unit.length > 0 ? `${t(panel.titleKey)} · ${unit}` : t(panel.titleKey);
}

/**
 * The wall-clock window a panel should show on first draw, as epoch seconds.
 *
 * **Why this exists.** lightweight-charts does not fit a series to the viewport on `setData`: it
 * shows the right-hand end at its default bar spacing (~6 px/bar), which in a 260 px-wide panel
 * is about 43 bars. That is what the first acceptance run showed — six panels each displaying a
 * sliver of its own data, at six different zoom levels, because each series has a different bar
 * count (1m candles ≈ 1440, 5m open interest ≈ 288, funding a handful of settlements).
 *
 * Giving every panel the SAME time range fixes both halves at once: each panel shows its whole
 * window, and the six line up by wall clock rather than by bar index. The union over all series
 * is used, not the candles alone, so a panel whose data starts later (funding, liquidations)
 * still sits at the right place on the shared axis instead of being stretched to fill.
 *
 * `null` when the window holds no points at all — nothing to fit, so the chart is left alone.
 */
export function windowBounds(data: PaneData): { from: number; to: number } | null {
  const times: number[] = [
    ...data.candles.candles.map((c) => c.time),
    ...data.openInterest.map((p) => p.time),
    ...data.liquidations.bars.map((b) => b.time),
    ...data.longShort.points.map((p) => p.time),
    ...data.funding.predicted.map((p) => p.time),
    ...data.funding.settled.flatMap((v) => v.points.map((p) => p.time)),
  ];
  if (times.length === 0) return null;
  const from = Math.min(...times);
  const to = Math.max(...times);
  // A single-point window has zero width, which lightweight-charts cannot display; widen it by
  // one minute so the point is visible rather than the panel going blank.
  return from === to ? { from: from - 30, to: to + 30 } : { from, to };
}

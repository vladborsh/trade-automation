import { HistogramSeries, type IChartApi, type ISeriesApi } from 'lightweight-charts';
import type { WebLiquidationBar } from '@trade-automation/contracts';
import { toLiquidationHistogram } from './series.adapter';

/**
 * IB-031 — the liquidations pane (architecture/insight-bot-web-dashboard.md §2).
 *
 * Its own renderer rather than the backtest SPA's `MetricSeriesRenderer`: that one draws a
 * single line or candle series from `MetricPoint`s, and this pane is two opposed histogram
 * series whose colours carry the meaning. Bending it around a second, differently shaped
 * consumer would make it worse at both jobs — dev-1 confirmed IB-030 needs no chart, so this
 * renderer has exactly one consumer and is shaped for it.
 *
 * **Longs up, shorts down, always two series.** The pane answers "which side was liquidated",
 * so summing the sides into one bar would erase the only thing it is for. Long liquidations are
 * drawn in the down colour and shorts in the up colour, because a long being liquidated is
 * price falling — the colour matches what the market did, not the noun.
 */

/** The dark-terminal palette (AGENTS.md), not a near-duplicate of it. */
export const LIQUIDATION_COLORS = {
  /** Longs liquidated — price fell. */
  long: '#ef5350',
  /** Shorts liquidated — price rose. */
  short: '#26a69a',
} as const;

export class LiquidationHistogramRenderer {
  private longs: ISeriesApi<'Histogram'> | null = null;
  private shorts: ISeriesApi<'Histogram'> | null = null;

  /**
   * `pane` matters: the bars are anchored at zero, so leaving them in the price pane drags the
   * price scale down to 0 and squashes the candles into a band. Found on the acceptance run.
   */
  attach(chart: IChartApi, pane = 0): void {
    // one price scale for both, so a 10× larger long cascade visibly dwarfs the shorts rather
    // than each side being auto-scaled to fill its own half
    const options = {
      priceFormat: { type: 'volume' as const },
      priceScaleId: 'right',
      lastValueVisible: false,
      priceLineVisible: false,
    };
    this.longs = chart.addSeries(HistogramSeries, { ...options, color: LIQUIDATION_COLORS.long }, pane);
    this.shorts = chart.addSeries(HistogramSeries, { ...options, color: LIQUIDATION_COLORS.short }, pane);
  }

  setData(bars: readonly WebLiquidationBar[]): void {
    if (!this.longs || !this.shorts) return;
    const { longs, shorts } = toLiquidationHistogram(bars, LIQUIDATION_COLORS);
    this.longs.setData(longs as never);
    this.shorts.setData(shorts as never);
  }

  detach(chart: IChartApi): void {
    if (this.longs) chart.removeSeries(this.longs);
    if (this.shorts) chart.removeSeries(this.shorts);
    this.longs = null;
    this.shorts = null;
  }

  get attached(): boolean {
    return this.longs !== null && this.shorts !== null;
  }
}

/**
 * The pane's title. It states the undercount rather than leaving it to documentation: Binance
 * emits at most one `forceOrder` event per second per symbol (§12.2), so these are *visible*
 * liquidations. A reader comparing the pane to a venue's own dashboard must know that, and a
 * footnote nobody opens is not knowing.
 */
export function liquidationPaneTitle(bucket: string, venue: string, undercounted: boolean): string {
  const scope = venue === 'all' ? 'all venues' : venue;
  const base = `Liquidations (${bucket}, ${scope})`;
  return undercounted ? `${base} — visible only: Binance sends at most 1 event/s per symbol` : base;
}

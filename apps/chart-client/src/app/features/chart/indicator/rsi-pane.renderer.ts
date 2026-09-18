import { LineSeries, LineStyle, type IChartApi, type ISeriesApi } from 'lightweight-charts';
import type { Candle } from '@trade-automation/contracts';
import { rsiLineData } from './rsi';

/** Index of the RSI pane — pane 0 is the price pane. */
const RSI_PANE_INDEX = 1;
/** Price pane keeps its default stretch factor 1; 1/3 against it gives the RSI pane ~25 % of the height. */
const RSI_PANE_STRETCH = 1 / 3;
const RSI_LINE_COLOR = '#d29922';
const RSI_GUIDE_COLOR = '#8b949e';
const RSI_GUIDES = [70, 30];

/**
 * architecture/chart-layouts.md §12.4 — owns the RSI `LineSeries` in its own native
 * lightweight-charts pane under the price pane (candle panels only). The pane shares the time
 * scale and crosshair with the price pane; its points sit exactly on candle times, so it adds
 * no time-scale slots and `ChartComponent`'s logical<->time bookkeeping is unaffected.
 *
 * Hidden = the series is removed; lightweight-charts 5.2.1 then drops the now-empty pane
 * (`_cleanupIfPaneIsEmpty`, since it was not added with `preserveEmptyPane`), so the price pane
 * takes the whole height back. Shown again = a fresh series (and pane) with a full `setData`.
 *
 * Must be rendered AFTER the price series for the same `candles` (a prepend read of the visible
 * logical range in `ChartComponent.withPreservedRangeOnPrepend` would otherwise see slots this
 * series had already prepended).
 */
export class RsiPaneRenderer {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Line'> | null = null;
  private visible = true;
  private period = 14;
  private candles: readonly Candle[] = [];
  /** What the series was last given: candle count, newest candle openTime (ms), period. */
  private lastCount = 0;
  private lastTime: number | null = null;
  private lastPeriod: number | null = null;

  /** Attaches to the chart and draws the current state (call after the price series got its data). */
  attach(chart: IChartApi, candles: readonly Candle[], period: number): void {
    this.chart = chart;
    this.render(candles, period);
  }

  /** Visibility + period change (from the panel's RSI chip / prefs); redraws `candles` if needed. */
  configure(visible: boolean, period: number, candles: readonly Candle[]): void {
    this.setVisible(visible);
    this.render(candles, period);
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) {
      return;
    }
    this.visible = visible;
    if (visible) {
      this.render(this.candles, this.period);
    } else {
      this.removeSeries();
    }
  }

  isShown(): boolean {
    return this.series !== null;
  }

  /**
   * Recomputes the RSI over the whole buffer (O(n), a few thousand bars at most) and pushes it:
   * `series.update()` on an incremental append/update of the newest candle (the forming tick —
   * mirrors `ChartComponent.renderCandles`), `setData` otherwise (first data, prepend, period
   * change, re-shown).
   */
  render(candles: readonly Candle[], period: number): void {
    this.candles = candles;
    this.period = period;
    if (!this.chart || !this.visible) {
      return;
    }
    const series = this.series ?? this.createSeries();
    const n = candles.length;
    const newestTime = n > 0 ? candles[n - 1].openTime : null;
    const sameShape = this.lastPeriod === period && this.lastCount > 0 && this.lastTime !== null;
    const isUpdate = sameShape && n === this.lastCount && newestTime === this.lastTime;
    const isAppend = sameShape && n === this.lastCount + 1 && candles[n - 2].openTime === this.lastTime;

    const data = rsiLineData(candles, period);
    if ((isUpdate || isAppend) && data.length > 0) {
      const last = data[data.length - 1];
      const prev = data[data.length - 2];
      // On an append the previously-newest bar may have closed at a different price than its
      // last forming tick: refresh it (still the series' last point) before appending the new one.
      if (isAppend && prev && this.lastTime !== null && prev.time === this.lastTime / 1000) {
        series.update(prev);
      }
      series.update(last);
    } else if (!isUpdate && !isAppend) {
      series.setData(data);
      series.applyOptions({ title: `RSI ${period}` });
    }
    this.lastCount = n;
    this.lastTime = newestTime;
    this.lastPeriod = period;
  }

  private createSeries(): ISeriesApi<'Line'> {
    const chart = this.chart as IChartApi;
    const series = chart.addSeries(
      LineSeries,
      {
        color: RSI_LINE_COLOR,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: true,
        priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
      },
      RSI_PANE_INDEX,
    );
    series.getPane().setStretchFactor(RSI_PANE_STRETCH);
    for (const price of RSI_GUIDES) {
      series.createPriceLine({
        price,
        color: RSI_GUIDE_COLOR,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
      });
    }
    this.series = series;
    this.resetRendered();
    return series;
  }

  private removeSeries(): void {
    if (this.chart && this.series) {
      this.chart.removeSeries(this.series);
    }
    this.series = null;
    this.resetRendered();
  }

  private resetRendered(): void {
    this.lastCount = 0;
    this.lastTime = null;
    this.lastPeriod = null;
  }
}

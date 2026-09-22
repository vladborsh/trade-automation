import { LineSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';

/** Its own overlay price scale, so the helper can never move the candles' price axis. */
export const PADDING_PRICE_SCALE = 't056-padding';

/**
 * T-056 (design §5.4, the BUG-007 ruling): what makes a replay panel whose tape ends early reach the
 * cursor. The ruling asks for whitespace after the last bar, but lightweight-charts (5.2) measures
 * its right-offset cap from the last index that holds **data in any series**, and whitespace holds
 * none — so trailing whitespace on the candle series extends the time scale yet still cannot be
 * scrolled to; and a time that holds no data gets no index, so a gap between bars collapses. This
 * hidden line series gives each padded time (`padToBucket`: every missing bucket, interior gaps
 * too) a point (value 0, invisible, on its own price scale): one index per bucket up to the cursor,
 * while the candle series itself stays exactly the real bars (no fills, indicators or position tools
 * ever see a padded time).
 */
export class PaddingSeries {
  private series: ISeriesApi<'Line'> | null = null;
  private shown: readonly number[] = [];

  attach(chart: IChartApi): void {
    this.series = chart.addSeries(LineSeries, {
      visible: false,
      priceScaleId: PADDING_PRICE_SCALE,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    this.shown = [];
  }

  /**
   * The padded open times (ms, ascending). An unchanged list is left alone; one bucket more at the end
   * (a step into a new bucket on a closed market) is a single `update`; anything else is a `setData`.
   */
  render(timesMs: readonly number[]): void {
    if (!this.series || sameTimes(timesMs, this.shown)) return;
    const appended = timesMs.length === this.shown.length + 1 && samePrefix(timesMs, this.shown);
    if (appended) this.series.update(point(timesMs[timesMs.length - 1]));
    else this.series.setData(timesMs.map(point));
    this.shown = timesMs;
  }
}

function point(t: number) {
  return { time: Math.floor(t / 1000) as UTCTimestamp, value: 0 };
}

/** Every element equal — an interior change with the same ends (a bar arriving inside a gap) is a change. */
function sameTimes(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && samePrefix(a, b);
}

/** `a` starts with every element of `prefix`, in order. */
function samePrefix(a: readonly number[], prefix: readonly number[]): boolean {
  for (let i = 0; i < prefix.length; i++) if (a[i] !== prefix[i]) return false;
  return true;
}

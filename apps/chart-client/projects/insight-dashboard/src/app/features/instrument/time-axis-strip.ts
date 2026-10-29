import {
  LineSeries, createChart, type IChartApi, type ISeriesApi, type LogicalRange, type MouseEventParams, type Time,
} from 'lightweight-charts';
import { PANEL_TIME_SCALE } from './panels.model';

/** The strip's height: the library's time axis at the default font, plus a hair of air. */
export const TIME_AXIS_HEIGHT = 30;

/**
 * Every distinct time across the chart's series, ascending. The strip's own time scale is built
 * from exactly this set, so a logical index means the same bar on both charts and the two can be
 * synced by logical range rather than by time (which drifts wherever the sets differ).
 */
export function unionTimes(seriesData: ReadonlyArray<ReadonlyArray<{ time: unknown }>>): number[] {
  const times = new Set<number>();
  for (const data of seriesData) for (const point of data) times.add(point.time as number);
  return [...times].sort((a, b) => a - b);
}

/** The slots on a chart's shared time scale: every distinct time across all its panes' series. */
export function chartTimes(chart: IChartApi): number[] {
  return unionTimes(chart.panes().flatMap((pane) => pane.getSeries().map((s) => s.data())));
}

/**
 * The reader's view carried across a redraw that prepended earlier history. Logical, not by time:
 * a reader who dragged past the oldest bar is looking at empty space, which a time range cannot
 * express (the library clips it to the data), so restoring by time zoomed them into the data
 * instead (2026-10-24). Every slot that now precedes the old first slot shifts the view right by one.
 */
export function shiftedView(view: LogicalRange, oldFirst: number, times: readonly number[]): LogicalRange {
  let added = 0;
  while (added < times.length && times[added] < oldFirst) added++;
  return { from: (view.from + added) as LogicalRange['from'], to: (view.to + added) as LogicalRange['to'] };
}

const sameRange = (a: LogicalRange | null, b: LogicalRange | null): boolean =>
  a !== null && b !== null && Math.abs(a.from - b.from) < 1e-6 && Math.abs(a.to - b.to) < 1e-6;

/**
 * The instrument chart's time axis as a chart of its own (user, 2026-10-24: "the time scale goes
 * off the screen when the panes are tall; it must stick to the bottom edge and always be visible").
 *
 * The library draws its time axis inside the chart's canvas, under the last pane, so it scrolls
 * away with the chart and nothing in CSS can pin it. The main chart's axis is therefore hidden and
 * this strip draws one: a second chart, one invisible series over the same times, and nothing else.
 * Its container is `position: sticky; bottom: 0`, so it sits at the bottom of the screen while the
 * panes run past it, and under the last pane when they end on screen.
 *
 * Kept in step with the main chart in both directions (dragging the strip scrolls the panes), with
 * the crosshair's time label, and with the main chart's price-scale width so the bars line up.
 */
export class TimeAxisStrip {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Line'> | null = null;
  private main: IChartApi | null = null;

  constructor(private readonly host: HTMLElement) {}

  attach(main: IChartApi, colours: { background: string; text: string }): void {
    this.destroy();
    this.main = main;
    const chart = createChart(this.host, {
      width: this.host.clientWidth,
      height: TIME_AXIS_HEIGHT,
      layout: { background: { color: colours.background }, textColor: colours.text, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { visible: true, borderVisible: false, ticksVisible: false },
      timeScale: { ...PANEL_TIME_SCALE, visible: true, borderVisible: false },
      crosshair: { horzLine: { visible: false, labelVisible: false }, vertLine: { visible: false } },
    });
    const series = chart.addSeries(LineSeries, {
      color: 'transparent', lineVisible: false, pointMarkersVisible: false, crosshairMarkerVisible: false,
      lastValueVisible: false, priceLineVisible: false,
    });
    const times = chartTimes(main);
    series.setData(times.map((time) => ({ time: time as Time, value: 0 })));
    this.chart = chart;
    this.series = series;

    main.timeScale().subscribeVisibleLogicalRangeChange(this.followMain);
    chart.timeScale().subscribeVisibleLogicalRangeChange(this.followStrip);
    main.subscribeCrosshairMove(this.followCrosshair);
    this.followMain(main.timeScale().getVisibleLogicalRange());
  }

  /** The container's width, and the main chart's price-scale width so the plot areas match. */
  resize(): void {
    const chart = this.chart;
    const main = this.main;
    if (!chart || !main) return;
    const scale = main.priceScale('right').width();
    if (scale > 0) chart.priceScale('right').applyOptions({ minimumWidth: scale });
    const width = this.host.clientWidth;
    if (chart.options().width !== width) chart.resize(width, TIME_AXIS_HEIGHT);
  }

  destroy(): void {
    if (this.main && this.chart) {
      // the main chart may already be removed by its owner; unsubscribing from it is then moot
      try {
        this.main.timeScale().unsubscribeVisibleLogicalRangeChange(this.followMain);
        this.main.unsubscribeCrosshairMove(this.followCrosshair);
      } catch {
        // removed
      }
    }
    this.chart?.remove();
    this.chart = null;
    this.series = null;
    this.main = null;
  }

  private readonly followMain = (range: LogicalRange | null): void => {
    const strip = this.chart?.timeScale();
    if (!strip || range === null || sameRange(strip.getVisibleLogicalRange(), range)) return;
    strip.setVisibleLogicalRange(range);
  };

  private readonly followStrip = (range: LogicalRange | null): void => {
    const main = this.main?.timeScale();
    if (!main || range === null || sameRange(main.getVisibleLogicalRange(), range)) return;
    main.setVisibleLogicalRange(range);
  };

  private readonly followCrosshair = (param: MouseEventParams): void => {
    if (!this.chart || !this.series) return;
    if (param.time === undefined) this.chart.clearCrosshairPosition();
    else this.chart.setCrosshairPosition(0, param.time, this.series);
  };
}

import {
  ChangeDetectionStrategy, Component, ElementRef, effect, input, viewChild, type OnDestroy,
} from '@angular/core';
import {
  CandlestickSeries, LineSeries, createChart, type IChartApi, type Time,
} from 'lightweight-charts';
import type {
  WebCandlesResponse, WebFundingResponse, WebLiquidationsResponse, WebLongShortResponse,
} from '@trade-automation/contracts';
import { MetricSeriesRenderer } from '@backtest-features/chart/metric-series.renderer';
import {
  toCandleData, toCvdSegments, toFundingSteps, toLongShortLine, toOpenInterestPoints,
  toPredictedFunding, toTakerDelta,
} from './series.adapter';
import { LiquidationHistogramRenderer, liquidationPaneTitle } from './liquidation-histogram.renderer';

export interface PaneData {
  instrument: string;
  timeframe: string;
  bucket: string;
  candles: WebCandlesResponse;
  openInterest: Array<{ time: number; value: number; notional: number | null }>;
  funding: WebFundingResponse;
  longShort: WebLongShortResponse;
  liquidations: WebLiquidationsResponse;
}

/**
 * IB-031 — the instrument page's chart stack (architecture/insight-bot-web-dashboard.md §2).
 *
 * **One chart with panes, not several charts.** Every pane shares the chart's time scale, which
 * is what "time-aligned" means: a cascade in the liquidation pane sits under the exact candle
 * it happened in, and scrolling moves all of them together. Separate charts would drift apart
 * the moment anyone panned one.
 *
 * Reused as is through the `@backtest-features` alias: **`MetricSeriesRenderer`** draws the open
 * interest pane unchanged, which is why the server serves OI in the `MetricPoint` wire shape.
 * Not reused: the backtest SPA's `ChartPanelComponent` and its panel/feed model, which are
 * built around that app's layout feed and would have to be bent around a second, differently
 * driven page — the same judgement dev-1 applied to `RestClient` in IB-030.
 */
@Component({
  selector: 'app-instrument-chart',
  standalone: true,
  templateUrl: './instrument-chart.component.html',
  styleUrl: './instrument-chart.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstrumentChartComponent implements OnDestroy {
  readonly data = input<PaneData | null>(null);

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('chartHost');
  private chart: IChartApi | null = null;
  private readonly oi = new MetricSeriesRenderer();
  private readonly liquidations = new LiquidationHistogramRenderer();

  readonly paneTitle = liquidationPaneTitle;

  constructor() {
    effect(() => {
      const data = this.data();
      if (!data) return;
      this.ensureChart();
      this.draw(data);
    });
  }

  ngOnDestroy(): void {
    this.chart?.remove();
    this.chart = null;
  }

  private ensureChart(): void {
    if (this.chart) return;
    this.chart = createChart(this.host().nativeElement, {
      layout: { background: { color: '#0d1117' }, textColor: '#c9d1d9', panes: { separatorColor: '#30363d' } },
      grid: { vertLines: { color: '#30363d' }, horzLines: { color: '#30363d' } },
      rightPriceScale: { borderColor: '#30363d' },
      timeScale: { borderColor: '#30363d', timeVisible: true, secondsVisible: false },
      autoSize: true,
    });
    // price dominates; the five reading panes share the rest. Without this every pane is equal
    // and the candles — the thing every other pane is read against — are a sixth of the screen.
    this.chart.panes()[0]?.setStretchFactor(3);
  }

  /**
   * Redraws every pane from scratch. The page fetches a whole window at a time, so there is no
   * incremental path to get wrong — and `setData` on an existing series keeps the user's zoom.
   */
  private draw(data: PaneData): void {
    const chart = this.chart;
    if (!chart) return;

    const price = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    }, 0);
    price.setData(toCandleData(data.candles.candles) as never);

    // pane 1: OI notional is ~10^9 against price's ~10^4, so sharing pane 0 flattens the
    // candles into a line. Found on the acceptance run, fixed by giving the shared renderer an
    // optional pane rather than forking it.
    if (!this.oi.series) this.oi.attach(chart, data.timeframe as never, 1);
    this.oi.setData(toOpenInterestPoints(data.openInterest, data.instrument, data.timeframe));

    // pane 2 for the same reason as OI: the bars sit at zero and would pull the price scale
    // down to 0, squashing the candles into a band at the top
    if (!this.liquidations.attached) this.liquidations.attach(chart, 2);
    this.liquidations.setData(data.liquidations.bars);

    // CVD is drawn as segments so an outage stays a hole rather than a straight line
    for (const segment of toCvdSegments(data.candles.candles)) {
      chart.addSeries(LineSeries, { color: '#8b949e', lineWidth: 1, lastValueVisible: false }, 3)
        .setData(segment as unknown as Array<{ time: Time; value: number }>);
    }
    chart.addSeries(LineSeries, { color: '#c9d1d9', lineWidth: 1, lastValueVisible: false }, 3)
      .setData(toTakerDelta(data.candles.candles) as unknown as Array<{ time: Time; value: number }>);

    for (const venue of data.funding.settled) {
      chart.addSeries(LineSeries, { color: '#26a69a', lineWidth: 1, lastValueVisible: false }, 4)
        .setData(toFundingSteps(venue.points) as unknown as Array<{ time: Time; value: number }>);
    }
    chart.addSeries(LineSeries, { color: '#8b949e', lineWidth: 1, lineStyle: 2, lastValueVisible: false }, 4)
      .setData(toPredictedFunding(data.funding) as unknown as Array<{ time: Time; value: number }>);

    chart.addSeries(LineSeries, { color: '#c9d1d9', lineWidth: 1, lastValueVisible: false }, 5)
      .setData(toLongShortLine(data.longShort) as unknown as Array<{ time: Time; value: number }>);
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  InjectionToken,
  type OnDestroy,
  computed,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { BaselineSeries, type IChartApi, type ISeriesApi, LineSeries, LineType, type UTCTimestamp, createChart } from 'lightweight-charts';
import type { EquityPoint } from '@trade-automation/contracts';
import { CHART_OPTIONS } from '../chart/chart-options';
import { type EquityUnit, drawdownChartData, equityChartData } from './stats-full';

/** `createChart`, as a token so specs can supply a fake chart (the test DOM has no canvas). */
export const EQUITY_CHART_FACTORY = new InjectionToken<typeof createChart>('EQUITY_CHART_FACTORY', {
  providedIn: 'root',
  factory: () => createChart,
});

/**
 * backtest-app-system-design.md §8, decision 26 — the session's equity curve as a step line (a step
 * per close, seeded at the period start), in currency or in R, with the drawdown from the running
 * peak as a red area at the bottom, filled from 0 down to the drawdown. Its own small lightweight-charts instance, not the replay chart.
 * Every raw point is also listed (visually hidden): the data behind the picture, and the diff hook.
 */
@Component({
  selector: 'app-equity-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './equity-chart.component.html',
  styleUrl: './equity-chart.component.scss',
})
export class EquityChartComponent implements OnDestroy {
  readonly points = input.required<readonly EquityPoint[]>();
  readonly unit = input<EquityUnit>('ccy');

  private readonly factory = inject(EQUITY_CHART_FACTORY);
  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');
  private chart: IChartApi | null = null;
  private equity: ISeriesApi<'Line'> | null = null;
  private drawdown: ISeriesApi<'Baseline'> | null = null;

  readonly equityData = computed(() => equityChartData(this.points(), this.unit()));
  readonly drawdownData = computed(() => drawdownChartData(this.points(), this.unit()));

  constructor() {
    effect(() => {
      const equity = this.equityData();
      const drawdown = this.drawdownData();
      const el = this.container().nativeElement;
      if (!this.chart) this.create(el);
      this.equity?.setData(equity.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      this.drawdown?.setData(drawdown.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      this.chart?.timeScale().fitContent();
    });
  }

  ngOnDestroy(): void {
    this.chart?.remove();
    this.chart = null;
  }

  private create(el: HTMLDivElement): void {
    this.chart = this.factory(el, { ...CHART_OPTIONS, crosshair: { mode: 1 } });
    this.equity = this.chart.addSeries(LineSeries, { color: '#26a69a', lineWidth: 2, lineType: LineType.WithSteps, priceLineVisible: false });
    // Filled between 0 and the line, so the red grows as the account sinks below its peak.
    this.drawdown = this.chart.addSeries(BaselineSeries, {
      priceScaleId: 'drawdown',
      baseValue: { type: 'price', price: 0 },
      topLineColor: 'rgba(0, 0, 0, 0)',
      topFillColor1: 'rgba(0, 0, 0, 0)',
      topFillColor2: 'rgba(0, 0, 0, 0)',
      bottomLineColor: '#ef5350',
      bottomFillColor1: 'rgba(239, 83, 80, 0.15)',
      bottomFillColor2: 'rgba(239, 83, 80, 0.45)',
      lineWidth: 1,
      lineType: LineType.WithSteps,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    this.chart.priceScale('drawdown').applyOptions({ scaleMargins: { top: 0.72, bottom: 0 } });
    this.equity.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.32 } });
  }
}

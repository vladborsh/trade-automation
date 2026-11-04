import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, effect, inject, input, viewChild } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import type { WebFlowsPoint } from '@trade-automation/contracts';
import { createChart, LineSeries, type IChartApi, type ISeriesApi } from 'lightweight-charts';
import { canDraw, toLineData } from './mini-chart-data';

/**
 * IB-091 — a tile's mini-chart: one line, no axes, no grid, sized by its box (`autoSize`). The
 * line's last value is not drawn as a label: the tile already prints it.
 */
@Component({
  selector: 'app-mini-chart',
  standalone: true,
  templateUrl: './mini-chart.component.html',
  styleUrl: './mini-chart.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MiniChartComponent {
  readonly series = input.required<readonly WebFlowsPoint[]>();
  readonly colour = input<string>('#8b949e');

  private readonly box = viewChild.required<ElementRef<HTMLDivElement>>('box');
  private chart: IChartApi | null = null;
  private line: ISeriesApi<'Line'> | null = null;

  constructor() {
    const doc = inject(DOCUMENT);
    afterNextRender(() => {
      if (!canDraw(doc)) return;
      this.chart = createChart(this.box().nativeElement, {
        autoSize: true,
        layout: { background: { color: 'transparent' }, textColor: '#8b949e', attributionLogo: false },
        grid: { vertLines: { visible: false }, horzLines: { visible: false } },
        rightPriceScale: { visible: false },
        leftPriceScale: { visible: false },
        timeScale: { visible: false },
        crosshair: { vertLine: { visible: false }, horzLine: { visible: false } },
        handleScroll: false,
        handleScale: false,
      });
      this.line = this.chart.addSeries(LineSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
      this.apply();
    });
    effect(() => {
      this.series();
      this.colour();
      this.apply();
    });
    inject(DestroyRef).onDestroy(() => this.chart?.remove());
  }

  private apply(): void {
    if (!this.line || !this.chart) return;
    this.line.applyOptions({ color: this.colour() });
    this.line.setData(toLineData(this.series()));
    this.chart.timeScale().fitContent();
  }
}

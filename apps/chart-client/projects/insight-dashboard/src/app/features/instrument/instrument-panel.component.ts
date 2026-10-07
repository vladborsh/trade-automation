import {
  ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, viewChild,
  type OnDestroy,
} from '@angular/core';
import { createChart, type IChartApi } from 'lightweight-charts';
import { I18nService } from '../../i18n/i18n.service';
import type { PanelDef } from './panel-definitions';

/**
 * IB-BUG-009 — one panel of the instrument row: a title, an optional legend, and a chart that
 * draws whatever its `PanelDef` says.
 *
 * It owns a chart of its own rather than a pane of a shared one, which is what lets each panel
 * **autoscale to its own visible data**. Nothing here sets a fixed range or a zero base:
 * lightweight-charts fits the visible points by default and re-fits on scroll and zoom, and
 * T-065 is the reminder of what a hand-set range costs — dead space nobody can scroll out of.
 */
@Component({
  selector: 'app-instrument-panel',
  standalone: true,
  templateUrl: './instrument-panel.component.html',
  styleUrl: './instrument-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstrumentPanelComponent implements OnDestroy {
  readonly panel = input.required<PanelDef>();

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('chartHost');
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  private chart: IChartApi | null = null;

  constructor() {
    effect(() => {
      const panel = this.panel();
      // the chart is rebuilt per data change rather than diffed: the page fetches a whole window
      // at a time, so there is no incremental path to get subtly wrong
      this.destroy();
      this.chart = createChart(this.host().nativeElement, {
        layout: { background: { color: '#0d1117' }, textColor: '#c9d1d9' },
        grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
        rightPriceScale: {
          borderColor: '#30363d',
          // small margins so the highest and lowest visible points nearly touch the edges
          scaleMargins: { top: 0.08, bottom: 0.08 },
        },
        timeScale: { borderColor: '#30363d', timeVisible: true, secondsVisible: false },
        autoSize: true,
        handleScroll: true,
        handleScale: true,
      });
      panel.draw(this.chart);
      this.chart.timeScale().fitContent();
    });
  }

  ngOnDestroy(): void {
    this.destroy();
  }

  private destroy(): void {
    this.chart?.remove();
    this.chart = null;
  }
}

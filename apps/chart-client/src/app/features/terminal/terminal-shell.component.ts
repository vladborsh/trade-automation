import { ChangeDetectionStrategy, Component, HostListener, computed, viewChild } from '@angular/core';
import { CandlesStore } from '../../core/state/candles.store';
import { SignalsStore } from '../../core/state/signals.store';
import { IndicatorsStore } from '../../core/state/indicators.store';
import { StrategiesStore } from '../../core/state/strategies.store';
import { TimeframeStore } from '../../core/state/timeframe.store';
import { MarketFeedService } from '../../core/state/market-feed.service';
import { InstrumentSwitcherComponent } from '../instrument-switcher/instrument-switcher.component';
import { TimeframePickerComponent } from '../timeframe-picker/timeframe-picker.component';
import { StatusBarComponent } from '../status-bar/status-bar.component';
import { ResearchBadgeComponent } from '../research-badge/research-badge.component';
import { ChartComponent } from '../chart/chart.component';
import { signalsToOverlays } from '../chart/overlay/signal-to-overlays';

/**
 * Layout: top bar + chart pane + (future) side panel slot (§5.2). The side
 * panel and the OverlayLayer are the two extension points for showing
 * richer signal information later — nothing else here should need to
 * change when that lands.
 */
@Component({
  selector: 'app-terminal-shell',
  standalone: true,
  imports: [
    InstrumentSwitcherComponent,
    TimeframePickerComponent,
    StatusBarComponent,
    ResearchBadgeComponent,
    ChartComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="terminal">
      <div class="top-bar">
        <app-instrument-switcher #switcher />
        <app-timeframe-picker />
        <app-research-badge />
      </div>
      <div class="body">
        <div class="chart-pane">
          <app-chart
            [candles]="candles.candles()"
            [overlays]="overlays()"
            [indicatorPoints]="indicators.points()"
            [indicatorSpecs]="strategies.indicatorSpecs()"
            [timeframe]="timeframe.selected()"
            (loadOlderRequested)="onLoadOlder()"
          />
        </div>
        <div class="side-panel">
          <!-- extension point: a future signal list/detail panel goes here -->
        </div>
      </div>
      <app-status-bar />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100vh;
        background: #0d1117;
        color: #c9d1d9;
        font-family: ui-monospace, 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
      }
      .terminal {
        display: flex;
        flex-direction: column;
        height: 100%;
      }
      .top-bar {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 6px 12px;
        border-bottom: 1px solid #30363d;
      }
      .body {
        display: flex;
        flex: 1;
        min-height: 0;
      }
      .chart-pane {
        flex: 1;
        min-width: 0;
      }
      .side-panel {
        width: 0;
        overflow: hidden;
        border-left: 1px solid #30363d;
      }
    `,
  ],
})
export class TerminalShellComponent {
  private readonly switcher = viewChild<InstrumentSwitcherComponent>('switcher');

  readonly overlays = computed(() => signalsToOverlays(this.signals.signals()));

  constructor(
    readonly candles: CandlesStore,
    private readonly signals: SignalsStore,
    readonly indicators: IndicatorsStore,
    readonly strategies: StrategiesStore,
    readonly timeframe: TimeframeStore,
    private readonly feed: MarketFeedService,
  ) {
    this.feed.boot().catch((err) => console.error('[TerminalShell] boot failed', err));
  }

  onLoadOlder(): void {
    void this.feed.loadOlderHistory();
  }

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

    if (event.key === '/' && !isTyping) {
      event.preventDefault();
      this.switcher()?.focusInput();
      return;
    }
    if (isTyping) {
      return;
    }
    if (event.key === '[') {
      this.timeframe.previous();
    } else if (event.key === ']') {
      this.timeframe.next();
    }
  }
}

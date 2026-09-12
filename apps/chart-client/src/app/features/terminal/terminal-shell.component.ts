import { ChangeDetectionStrategy, Component, HostListener } from '@angular/core';
import { LayoutFeedService } from '../../core/state/layout-feed.service';
import { TimeframeStore } from '../../core/state/timeframe.store';
import { LayoutSwitcherComponent } from '../layout-switcher/layout-switcher.component';
import { TimeframePickerComponent } from '../timeframe-picker/timeframe-picker.component';
import { StatusBarComponent } from '../status-bar/status-bar.component';
import { PanelGridComponent } from '../panel-grid/panel-grid.component';

/**
 * architecture/chart-layouts.md §6.1 — top bar (layout switcher + timeframe
 * picker) + `<app-panel-grid>` body + status bar. Replaces the single-chart
 * shell: the instrument switcher and the single `<app-chart>`/research-badge
 * pairing are gone from here — each panel now hosts its own chart and its
 * own (per-panel-scoped) research badge, see chart-panel.component.ts.
 */
@Component({
  selector: 'app-terminal-shell',
  standalone: true,
  imports: [LayoutSwitcherComponent, TimeframePickerComponent, StatusBarComponent, PanelGridComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="terminal">
      <div class="top-bar">
        <app-layout-switcher />
        <app-timeframe-picker />
      </div>
      <div class="body">
        <app-panel-grid />
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
    `,
  ],
})
export class TerminalShellComponent {
  constructor(
    private readonly feed: LayoutFeedService,
    private readonly timeframe: TimeframeStore,
  ) {
    this.feed.boot().catch((err: unknown) => console.error('[TerminalShell] boot failed', err));
  }

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
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

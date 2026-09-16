import { ChangeDetectionStrategy, Component, HostListener } from '@angular/core';
import { LayoutFeedService } from '../../core/state/layout-feed.service';
import { TimeframeStore } from '../../core/state/timeframe.store';
import { ViewStore } from '../../core/state/view.store';
import { CalendarFeedService } from '../../core/state/calendar-feed.service';
import { LayoutSwitcherComponent } from '../layout-switcher/layout-switcher.component';
import { TimeframePickerComponent } from '../timeframe-picker/timeframe-picker.component';
import { StatusBarComponent } from '../status-bar/status-bar.component';
import { PanelGridComponent } from '../panel-grid/panel-grid.component';
import { ViewSwitcherComponent } from '../view-switcher/view-switcher.component';
import { NotificationBellComponent } from '../notifications/notification-bell.component';
import { ToastHostComponent } from '../notifications/toast-host.component';
import { CalendarWeekComponent } from '../calendar/calendar-week.component';

/**
 * architecture/chart-layouts.md §6.1 — top bar (layout switcher + timeframe
 * picker) + `<app-panel-grid>` body + status bar. Replaces the single-chart
 * shell: the instrument switcher and the single `<app-chart>`/research-badge
 * pairing are gone from here — each panel now hosts its own chart and its
 * own (per-panel-scoped) research badge, see chart-panel.component.ts.
 *
 * architecture/economic-calendar.md §7.1 / D9 — gains a top-level
 * charts⇄calendar view switch (not a panel kind, not a router route) plus a
 * notification bell and a toast host overlaying either view. The panel grid
 * keeps running (and its feeds subscribed) even while the calendar view is
 * shown, so switching back is instant; the panel grid stays mounted and is
 * only `[hidden]`, while the calendar view is created/destroyed on demand.
 */
@Component({
  selector: 'app-terminal-shell',
  standalone: true,
  imports: [
    LayoutSwitcherComponent,
    TimeframePickerComponent,
    StatusBarComponent,
    PanelGridComponent,
    ViewSwitcherComponent,
    NotificationBellComponent,
    ToastHostComponent,
    CalendarWeekComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="terminal">
      <div class="top-bar">
        <app-view-switcher />
        <app-layout-switcher />
        <app-timeframe-picker />
        <app-notification-bell class="bell-slot" />
      </div>
      <div class="body">
        <div class="panel-view" [hidden]="view.activeView() !== 'charts'">
          <app-panel-grid />
        </div>
        @if (view.activeView() === 'calendar') {
          <app-calendar-week />
        }
      </div>
      <app-status-bar />
      <app-toast-host />
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
        position: relative;
      }
      .panel-view {
        display: flex;
        flex: 1;
        min-height: 0;
        min-width: 0;
      }
      .bell-slot {
        margin-left: auto;
      }
    `,
  ],
})
export class TerminalShellComponent {
  constructor(
    private readonly feed: LayoutFeedService,
    private readonly calendarFeed: CalendarFeedService,
    private readonly timeframe: TimeframeStore,
    readonly view: ViewStore,
  ) {
    // The calendar topic must be live regardless of which view is active
    // (§7.1), so it boots right after the panel/layout feed, not lazily
    // when the calendar view is first opened.
    this.feed
      .boot()
      .then(() => this.calendarFeed.boot())
      .catch((err: unknown) => console.error('[TerminalShell] boot failed', err));
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
    } else if (event.key === 'c') {
      this.view.toggle();
    }
  }
}

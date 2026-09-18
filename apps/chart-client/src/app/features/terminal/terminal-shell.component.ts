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
  templateUrl: './terminal-shell.component.html',
  styleUrl: './terminal-shell.component.scss',
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

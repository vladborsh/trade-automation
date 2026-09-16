import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, signal } from '@angular/core';
import { CalendarStore } from '../../core/state/calendar.store';
import { CalendarFeedService } from '../../core/state/calendar-feed.service';
import { CalendarFiltersStore, passesFilters } from '../../core/state/calendar-filters.store';
import type { EconomicEvent } from '../../core/contracts/calendar';
import { dayHeaderLabel, etDayString, etTimeLabel, localTimeLabel } from './et-time';
import { CalendarFiltersComponent } from './calendar-filters.component';
import { CalendarEventDetailComponent } from './calendar-event-detail.component';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * §7.1 — the second body view (D9): seven day columns grouped by
 * `scheduledDay` (ET, per the feed's own day boundaries). Times render in
 * the browser's local zone with the ET time in a tooltip; the header says
 * the columns are New York days so that distinction is never ambiguous.
 */
@Component({
  selector: 'app-calendar-week',
  standalone: true,
  imports: [CalendarFiltersComponent, CalendarEventDetailComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="calendar-week" data-testid="calendar-week">
      <div class="week-header">
        <button type="button" (click)="previousWeek()" aria-label="Previous week">‹</button>
        <span class="week-range">{{ weekRangeLabel() }}</span>
        <button type="button" (click)="nextWeek()" aria-label="Next week">›</button>
        <span class="tz-note">days are New York days</span>
      </div>

      <app-calendar-filters [countries]="availableCountries()" />

      <div class="grid" [style.grid-template-columns]="'repeat(' + days().length + ', 1fr)'">
        @for (day of days(); track day) {
          <div class="day-col" [class.today]="day === today()" [attr.data-day]="day">
            <div class="day-header">{{ dayHeaderLabel(day) }}</div>
            @for (row of rowsFor(day); track rowKey(row)) {
              @if (row.kind === 'now') {
                <div class="now-line" data-testid="now-line">now — {{ localTimeLabel(row.at) }}</div>
              } @else {
                <div
                  class="event-row"
                  [class]="'status-' + row.event.status"
                  [class.highlighted]="highlightedId() === row.event.id"
                  [attr.data-event-id]="row.event.id"
                  [attr.title]="etTimeLabel(row.event.scheduledAt)"
                  (click)="selectEvent(row.event.id)"
                >
                  <span class="time">{{ localTimeLabel(row.event.scheduledAt) }}</span>
                  <span class="impact-dot" [class]="'impact-' + row.event.impact"></span>
                  <span class="country">{{ row.event.country }}</span>
                  <span class="title">{{ row.event.title }}</span>
                  <span class="forecast">{{ row.event.forecast ?? '—' }}</span>
                  <span class="previous">{{ row.event.previous ?? '—' }}</span>
                  <span class="actual" [class]="'prov-' + (row.event.actualSource ?? 'none')">
                    {{ row.event.actual ?? '—' }}
                  </span>
                </div>
              }
            } @empty {
              <div class="empty-day">No events</div>
            }
          </div>
        }
      </div>
    </div>

    @if (selectedEventId(); as id) {
      <app-calendar-event-detail [eventId]="id" (closed)="selectedEventId.set(null)" />
    }
  `,
  styles: [
    `
      .calendar-week {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        min-height: 0;
        overflow: auto;
      }
      .week-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 12px;
        border-bottom: 1px solid #30363d;
      }
      .week-header button {
        background: #0d1117;
        color: #c9d1d9;
        border: 1px solid #30363d;
        cursor: pointer;
      }
      .week-range {
        font-weight: 600;
      }
      .tz-note {
        margin-left: auto;
        color: #8b949e;
        font-size: 11px;
      }
      .grid {
        display: grid;
        flex: 1;
        min-height: 0;
      }
      .day-col {
        border-right: 1px solid #21262d;
        padding: 4px;
        overflow-y: auto;
      }
      .day-col.today {
        background: #11161d;
      }
      .day-header {
        font-size: 11px;
        color: #8b949e;
        padding: 4px 2px;
        border-bottom: 1px solid #21262d;
        margin-bottom: 4px;
      }
      .event-row {
        display: grid;
        grid-template-columns: auto auto auto 1fr auto auto auto;
        gap: 4px;
        align-items: center;
        font-size: 11px;
        padding: 3px 2px;
        cursor: pointer;
      }
      .event-row:hover {
        background: #161b22;
      }
      .event-row.highlighted {
        background: #1f2a3a;
        outline: 1px solid #58a6ff;
      }
      .event-row.status-released {
        opacity: 0.55;
      }
      .event-row.status-removed {
        text-decoration: line-through;
        opacity: 0.4;
      }
      .impact-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        display: inline-block;
      }
      .impact-low {
        background: #8b949e;
      }
      .impact-medium {
        background: #d29922;
      }
      .impact-high {
        background: #ef5350;
      }
      .impact-holiday {
        background: #58a6ff;
      }
      .impact-unknown {
        background: #30363d;
      }
      .now-line {
        color: #58a6ff;
        font-size: 10px;
        border-top: 1px dashed #58a6ff;
        padding: 2px 0;
      }
      .empty-day {
        color: #8b949e;
        font-size: 11px;
        padding: 4px 2px;
      }
    `,
  ],
})
export class CalendarWeekComponent {
  readonly selectedEventId = signal<string | null>(null);
  readonly today = computed(() => etDayString(Date.now()));
  // Not `= this.calendar.highlightedEventId` — field initializers run before
  // constructor-injected params are assigned (NG/TS2729); a `computed()`
  // defers the read to first access instead.
  readonly highlightedId = computed(() => this.calendar.highlightedEventId());

  readonly days = computed<string[]>(() => this.calendar.window()?.days ?? [...this.calendar.eventsByDay().keys()].sort());

  readonly availableCountries = computed<string[]>(() => {
    const set = new Set<string>();
    for (const event of this.calendar.events()) {
      set.add(event.country);
    }
    return [...set];
  });

  readonly weekRangeLabel = computed(() => {
    const window = this.calendar.window();
    if (!window) {
      return '';
    }
    return `${dayHeaderLabel(this.days()[0] ?? '')} – ${dayHeaderLabel(this.days()[this.days().length - 1] ?? '')}`;
  });

  readonly dayHeaderLabel = dayHeaderLabel;
  readonly etTimeLabel = etTimeLabel;
  readonly localTimeLabel = localTimeLabel;

  private weekAt: number | undefined;

  constructor(
    private readonly calendar: CalendarStore,
    private readonly calendarFeed: CalendarFeedService,
    private readonly filters: CalendarFiltersStore,
    hostRef: ElementRef<HTMLElement>,
  ) {
    effect(() => {
      const id = this.calendar.highlightedEventId();
      if (!id) {
        return;
      }
      queueMicrotask(() => {
        const row = hostRef.nativeElement.querySelector(`[data-event-id="${cssEscape(id)}"]`);
        row?.scrollIntoView({ block: 'center' });
      });
    });
  }

  rowsFor(day: string): DayRow[] {
    const events = (this.calendar.eventsByDay().get(day) ?? []).filter((e) => passesFilters(e, this.filters.filters()));
    const rows: DayRow[] = events.map((event) => ({ kind: 'event', event }));
    if (day === this.today()) {
      const now = Date.now();
      const insertAt = rows.findIndex((r) => r.kind === 'event' && r.event.scheduledAt > now);
      const nowRow: DayRow = { kind: 'now', at: now };
      if (insertAt === -1) {
        rows.push(nowRow);
      } else {
        rows.splice(insertAt, 0, nowRow);
      }
    }
    return rows;
  }

  rowKey(row: DayRow): string {
    return row.kind === 'now' ? 'now-line' : row.event.id;
  }

  selectEvent(id: string): void {
    this.selectedEventId.set(id);
  }

  previousWeek(): void {
    const from = this.calendar.window()?.from ?? Date.now();
    this.weekAt = from - WEEK_MS / 2;
    void this.calendarFeed.loadWeek(this.weekAt);
  }

  nextWeek(): void {
    const from = this.calendar.window()?.from ?? Date.now();
    this.weekAt = from + WEEK_MS + WEEK_MS / 2;
    void this.calendarFeed.loadWeek(this.weekAt);
  }
}

type DayRow = { kind: 'event'; event: EconomicEvent } | { kind: 'now'; at: number };

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

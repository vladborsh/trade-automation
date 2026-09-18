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
  templateUrl: './calendar-week.component.html',
  styleUrl: './calendar-week.component.scss',
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

import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, signal } from '@angular/core';
import { RestClient } from '../../core/api/rest.client';
import type { EventDetailResponse } from '../../core/contracts/calendar';
import { currencyWithFlag } from './currency-flag';

/** §7 `calendar-event-detail.component.ts` — drawer on row click: fetches the revision timeline. */
@Component({
  selector: 'app-calendar-event-detail',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './calendar-event-detail.component.html',
  styleUrl: './calendar-event-detail.component.scss',
})
export class CalendarEventDetailComponent implements OnChanges {
  @Input({ required: true }) eventId!: string;
  @Output() readonly closed = new EventEmitter<void>();

  readonly detail = signal<EventDetailResponse | null>(null);
  readonly currencyWithFlag = currencyWithFlag;

  constructor(private readonly rest: RestClient) {}

  ngOnChanges(): void {
    this.detail.set(null);
    void this.rest.getCalendarEvent(this.eventId).then((d) => this.detail.set(d));
  }
}

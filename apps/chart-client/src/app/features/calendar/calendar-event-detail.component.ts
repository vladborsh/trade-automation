import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, signal } from '@angular/core';
import { RestClient } from '../../core/api/rest.client';
import type { EventDetailResponse } from '../../core/contracts/calendar';

/** §7 `calendar-event-detail.component.ts` — drawer on row click: fetches the revision timeline. */
@Component({
  selector: 'app-calendar-event-detail',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="closed.emit()">
      <div class="drawer" (click)="$event.stopPropagation()">
        @if (detail(); as d) {
          <div class="drawer-header">
            <span class="title">{{ d.event.title }}</span>
            <button type="button" class="close" (click)="closed.emit()" aria-label="Close">×</button>
          </div>
          <div class="row"><span>Country</span><span>{{ d.event.country }}</span></div>
          <div class="row"><span>Impact</span><span>{{ d.event.impact }}</span></div>
          <div class="row"><span>Forecast</span><span>{{ d.event.forecast ?? '—' }}</span></div>
          <div class="row"><span>Previous</span><span>{{ d.event.previous ?? '—' }}</span></div>
          <div class="row"><span>Actual</span><span>{{ d.event.actual ?? '—' }} @if (d.event.actualSource) { ({{ d.event.actualSource }}) }</span></div>
          <div class="row"><span>Status</span><span>{{ d.event.status }}</span></div>
          <h4>Revisions</h4>
          <div class="revisions">
            @for (rev of d.revisions; track rev.revision) {
              <div class="revision">
                <span>#{{ rev.revision }} — {{ rev.change }}</span>
                <span class="at">{{ rev.at | date: 'short' }}</span>
              </div>
            } @empty {
              <div class="empty">No revisions.</div>
            }
          </div>
        } @else {
          <div class="loading">Loading…</div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.4);
        z-index: 200;
        display: flex;
        justify-content: flex-end;
      }
      .drawer {
        width: 360px;
        max-width: 90vw;
        height: 100%;
        background: #161b22;
        border-left: 1px solid #30363d;
        padding: 12px;
        overflow-y: auto;
        font-size: 12px;
        color: #c9d1d9;
      }
      .drawer-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }
      .title {
        font-weight: 600;
      }
      .close {
        background: none;
        border: none;
        color: #8b949e;
        cursor: pointer;
        font-size: 16px;
      }
      .row {
        display: flex;
        justify-content: space-between;
        padding: 4px 0;
        border-bottom: 1px solid #21262d;
      }
      h4 {
        margin: 12px 0 6px;
        color: #8b949e;
        font-size: 11px;
        text-transform: uppercase;
      }
      .revision {
        display: flex;
        justify-content: space-between;
        padding: 4px 0;
      }
      .at,
      .empty {
        color: #8b949e;
      }
      .loading {
        color: #8b949e;
      }
    `,
  ],
})
export class CalendarEventDetailComponent implements OnChanges {
  @Input({ required: true }) eventId!: string;
  @Output() readonly closed = new EventEmitter<void>();

  readonly detail = signal<EventDetailResponse | null>(null);

  constructor(private readonly rest: RestClient) {}

  ngOnChanges(): void {
    this.detail.set(null);
    void this.rest.getCalendarEvent(this.eventId).then((d) => this.detail.set(d));
  }
}

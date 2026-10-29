import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { I18nService } from '../../i18n/i18n.service';
import { eventTimeLabel, type CalendarMark } from './calendar-marks';

/**
 * IB-060 — the economic events on the bar under the crosshair, over the price pane: title, time
 * (UTC), forecast, previous and actual. A component of its own so the chart component stays under
 * the AGENTS.md ceiling; it is purely presentational, the chart decides which mark is hovered.
 *
 * `actual` usually lags a day: the bot fetches the feed once per UTC day (IB-058).
 */
@Component({
  selector: 'app-calendar-tooltip',
  standalone: true,
  templateUrl: './calendar-tooltip.component.html',
  styleUrl: './calendar-tooltip.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarTooltipComponent {
  /** The hovered bar's events, or null when the crosshair is not on an event line. */
  readonly mark = input<CalendarMark | null>(null);
  /** The crosshair's x in px within the chart; the tooltip sits just right of it. */
  readonly x = input(0);

  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);
  readonly when = eventTimeLabel;
}

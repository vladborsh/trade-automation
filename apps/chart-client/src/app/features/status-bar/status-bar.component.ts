import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import type { InstrumentId } from '@trade-automation/contracts';
import { ConnectionStore } from '../../core/state/connection.store';
import { LayoutsStore } from '../../core/state/layouts.store';
import { StrategiesStore } from '../../core/state/strategies.store';
import { CalendarStore } from '../../core/state/calendar.store';

interface StatusRow {
  instrument: InstrumentId;
  venueStatus: string | null;
  lastClosedCandleTime: number | null;
  strategies: string;
}

/**
 * architecture/chart-layouts.md §6.1 (SE-5 item 9) — iterates the active
 * layout's distinct instruments instead of the one globally selected
 * instrument the pre-layout terminal had.
 */
@Component({
  selector: 'app-status-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './status-bar.component.html',
  styleUrl: './status-bar.component.scss',
})
export class StatusBarComponent {
  constructor(
    readonly connection: ConnectionStore,
    private readonly layouts: LayoutsStore,
    private readonly strategies: StrategiesStore,
    private readonly calendar: CalendarStore,
  ) {}

  /** §7.1 — "next event" chip: the nearest future medium/high-impact event, visible on either view. */
  readonly nextEventChip = computed<string | null>(() => {
    const now = Date.now();
    const next = this.calendar
      .events()
      .filter((e) => e.status === 'scheduled' && e.scheduledAt > now && (e.impact === 'high' || e.impact === 'medium'))
      .sort((a, b) => a.scheduledAt - b.scheduledAt)[0];
    if (!next) {
      return null;
    }
    const minutesAway = Math.round((next.scheduledAt - now) / 60_000);
    const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(next.scheduledAt));
    return `next: ${time} ${next.country} ${next.title} (in ${minutesAway}m)`;
  });

  /**
   * architecture/vwap-band-reversal-plugin.md §6 item 3: still labelled
   * `id (tier)` per instrument so a research-tier strategy is never
   * mistaken for a live one, now repeated once per distinct instrument in
   * the active layout rather than once for a single selection.
   */
  readonly rows = computed<StatusRow[]>(() => {
    const layout = this.layouts.active();
    if (!layout) {
      return [];
    }
    const seen = new Set<InstrumentId>();
    const result: StatusRow[] = [];
    for (const panel of layout.panels) {
      if (seen.has(panel.instrument)) {
        continue;
      }
      seen.add(panel.instrument);
      const status = this.connection.statusFor(panel.instrument);
      const strategies = this.strategies
        .strategiesFor(panel.instrument)
        .filter((s) => s.enabled)
        .map((s) => `${s.id} (${s.tier})`)
        .join(', ');
      result.push({
        instrument: panel.instrument,
        venueStatus: status?.venueStatus ?? null,
        lastClosedCandleTime: status?.lastClosedCandleTime ?? null,
        strategies,
      });
    }
    return result;
  });
}

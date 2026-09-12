import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import type { InstrumentId } from '@trade-automation/contracts';
import { ConnectionStore } from '../../core/state/connection.store';
import { LayoutsStore } from '../../core/state/layouts.store';
import { StrategiesStore } from '../../core/state/strategies.store';

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
  template: `
    <div class="status-bar">
      <span class="conn" [class]="'conn-' + connection.connectionState()">{{ connection.connectionState() }}</span>
      @for (row of rows(); track row.instrument) {
        <span class="instrument-status">
          <span class="instrument">{{ row.instrument }}</span>
          @if (row.venueStatus; as vs) {
            <span class="venue" [class]="'venue-' + vs">{{ vs }}</span>
          }
          @if (row.strategies) {
            <span class="strategies">{{ row.strategies }}</span>
          }
        </span>
      }
    </div>
  `,
  styles: [
    `
      .status-bar {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        padding: 4px 12px;
        background: #0d1117;
        border-top: 1px solid #30363d;
        font-size: 11px;
        color: #8b949e;
      }
      .instrument-status {
        display: inline-flex;
        gap: 6px;
        align-items: center;
      }
      .conn-live {
        color: #26a69a;
      }
      .conn-connecting,
      .conn-reconnecting {
        color: #d29922;
      }
      .conn-offline {
        color: #ef5350;
      }
      .venue-up {
        color: #26a69a;
      }
      .venue-degraded {
        color: #d29922;
      }
      .venue-down,
      .venue-closed {
        color: #ef5350;
      }
      .strategies {
        color: #8b949e;
      }
    `,
  ],
})
export class StatusBarComponent {
  constructor(
    readonly connection: ConnectionStore,
    private readonly layouts: LayoutsStore,
    private readonly strategies: StrategiesStore,
  ) {}

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

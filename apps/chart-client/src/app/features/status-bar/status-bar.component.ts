import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { ConnectionStore } from '../../core/state/connection.store';
import { InstrumentsStore } from '../../core/state/instruments.store';
import { StrategiesStore } from '../../core/state/strategies.store';

@Component({
  selector: 'app-status-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="status-bar">
      <span class="conn" [class]="'conn-' + connection.connectionState()">{{ connection.connectionState() }}</span>
      @if (venueStatus(); as vs) {
        <span class="venue" [class]="'venue-' + vs.venueStatus">venue: {{ vs.venueStatus }}</span>
        @if (vs.lastClosedCandleTime !== null) {
          <span class="age">last bar: {{ ageLabel(vs.lastClosedCandleTime) }}</span>
        }
      }
      @if (instruments.selected(); as instrument) {
        <span class="instrument">{{ instrument.id }}</span>
      }
      @if (activeStrategies(); as list) {
        @if (list.length > 0) {
          <span class="strategies">strategies: {{ list }}</span>
        }
      }
    </div>
  `,
  styles: [
    `
      .status-bar {
        display: flex;
        gap: 16px;
        padding: 4px 12px;
        background: #0d1117;
        border-top: 1px solid #30363d;
        font-size: 11px;
        color: #8b949e;
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
    readonly instruments: InstrumentsStore,
    private readonly strategies: StrategiesStore,
  ) {}

  readonly venueStatus = computed(() => {
    const instrument = this.instruments.selected();
    return instrument ? this.connection.statusFor(instrument.id) : null;
  });

  /**
   * architecture/vwap-band-reversal-plugin.md §6 item 3: the strategy list
   * must show tier/displayName clearly, e.g. `strategies: vwap-band-reversal
   * (research)`, so a research-tier strategy is never mistaken for a live one.
   */
  readonly activeStrategies = computed(() => {
    const instrument = this.instruments.selected();
    if (!instrument) {
      return '';
    }
    return this.strategies
      .strategiesFor(instrument.id)
      .filter((s) => s.enabled)
      .map((s) => `${s.id} (${s.tier})`)
      .join(', ');
  });

  ageLabel(lastClosedCandleTime: number): string {
    const ageSeconds = Math.max(0, Math.floor((Date.now() - lastClosedCandleTime) / 1000));
    return `${ageSeconds}s ago`;
  }
}

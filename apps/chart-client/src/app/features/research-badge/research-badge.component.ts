import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { InstrumentsStore } from '../../core/state/instruments.store';
import { SignalsStore } from '../../core/state/signals.store';
import { IndicatorsStore } from '../../core/state/indicators.store';
import { StrategiesStore } from '../../core/state/strategies.store';

/**
 * architecture/vwap-band-reversal-plugin.md §6 item 4 — persistent badge,
 * shown whenever the selected instrument has any displayed signal or
 * indicator point with `tier !== 'live'`, or an enabled non-`live` strategy
 * covering it. Copy is fixed verbatim in the note; do not paraphrase it.
 */
@Component({
  selector: 'app-research-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <div class="research-badge" [class.expanded]="expanded()">
        <button type="button" class="badge-toggle" (click)="toggle()" [attr.aria-expanded]="expanded()">
          <strong>RESEARCH — not a trading signal</strong>
        </button>
        @if (expanded()) {
          <p class="badge-detail">
            "VWAP band reversal" is an unvalidated strategy still being tested. The amber markers and
            lines show where its rules would have fired. They are not trade recommendations and have
            no track record.
          </p>
        }
      </div>
    }
  `,
  styles: [
    `
      .research-badge {
        background: #2b2111;
        border: 1px solid #d29922;
        color: #d29922;
        font-size: 11px;
        padding: 4px 10px;
      }
      .badge-toggle {
        background: none;
        border: none;
        color: inherit;
        font: inherit;
        font-family: inherit;
        padding: 0;
        cursor: pointer;
        text-align: left;
      }
      .badge-detail {
        margin: 6px 0 0;
        max-width: 480px;
        line-height: 1.4;
        color: #e3b341;
      }
    `,
  ],
})
export class ResearchBadgeComponent {
  readonly expanded = signal(false);

  constructor(
    private readonly instruments: InstrumentsStore,
    private readonly signals: SignalsStore,
    private readonly indicators: IndicatorsStore,
    private readonly strategies: StrategiesStore,
  ) {}

  readonly visible = computed(() => {
    const instrument = this.instruments.selected()?.id ?? null;
    const hasNonLiveSignal = this.signals.signals().some((s) => s.tier !== 'live');
    const hasNonLiveIndicator = this.indicators.points().some((p) => p.tier !== 'live');
    const hasNonLiveStrategy = this.strategies.hasNonLiveStrategyFor(instrument);
    return hasNonLiveSignal || hasNonLiveIndicator || hasNonLiveStrategy;
  });

  toggle(): void {
    this.expanded.update((v) => !v);
  }
}

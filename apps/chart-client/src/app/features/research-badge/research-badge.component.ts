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
  templateUrl: './research-badge.component.html',
  styleUrl: './research-badge.component.scss',
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

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { SessionStats } from '@trade-automation/contracts';
import { statsItems } from './stats-items';

/**
 * backtest-app-system-design.md §8, decision 38 — the basic statistics, read-only: the server's full
 * recompute, and a notice when the aggregates stored on the session row differ from it.
 */
@Component({
  selector: 'app-stats-summary',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stats-summary.component.html',
  styleUrl: './stats-summary.component.scss',
})
export class StatsSummaryComponent {
  readonly stats = input.required<SessionStats | null>();
  readonly currency = input.required<string>();
  /** `GET …/stats` `drift`. */
  readonly drift = input(false);

  readonly items = computed(() => {
    const s = this.stats();
    return s ? statsItems(s, this.currency()) : [];
  });
}

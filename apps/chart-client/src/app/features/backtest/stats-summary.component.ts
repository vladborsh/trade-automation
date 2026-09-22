import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { SessionStats } from '@trade-automation/contracts';
import { headlineStats, statsItems } from './stats-items';

/**
 * backtest-app-system-design.md §8, decision 38 — the basic statistics, read-only: the server's full
 * recompute, and a notice when the aggregates stored on the session row differ from it. Only P&L
 * (currency and R) is shown until the user asks for the details (T-044).
 */
@Component({
  selector: 'app-stats-summary',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stats-summary.component.html',
  styleUrl: './stats-summary.component.scss',
})
export class StatsSummaryComponent {
  readonly stats = input.required<SessionStats | null>();
  readonly currency = input.required<string>();
  /** For the link to the full statistics screen (T-032). */
  readonly sessionId = input<string | null>(null);
  /** `GET …/stats` `drift`. */
  readonly drift = input(false);

  readonly items = computed(() => {
    const s = this.stats();
    return headlineStats(s ? statsItems(s, this.currency()) : []);
  });
  readonly detailsOpen = signal(false);

  toggleDetails(): void {
    this.detailsOpen.update((open) => !open);
  }
}

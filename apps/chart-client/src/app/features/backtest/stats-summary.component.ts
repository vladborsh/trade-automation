import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { SessionStats } from '@trade-automation/contracts';
import { headlineStats, statsItems } from './stats-items';

/**
 * backtest-app-system-design.md §8, decision 38 — the basic statistics, read-only: the server's full
 * recompute, and a notice when the aggregates stored on the session row differ from it. Only P&L
 * (currency and R) is shown until the user asks for the details (T-044).
 *
 * T-064: all on one line; Details is an overlay growing upward over the chart. It closes on a second
 * click, Esc (focus back on the toggle) or a click outside.
 */
@Component({
  selector: 'app-stats-summary',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stats-summary.component.html',
  styleUrl: './stats-summary.component.scss',
  host: { '(document:click)': 'onDocumentClick($event)', '(document:keydown.escape)': 'onEscape($event)' },
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

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly toggle = viewChild<ElementRef<HTMLButtonElement>>('toggle');

  toggleDetails(): void {
    this.detailsOpen.update((open) => !open);
  }

  onDocumentClick(event: MouseEvent): void {
    if (this.detailsOpen() && !this.host.nativeElement.contains(event.target as Node)) this.detailsOpen.set(false);
  }

  /**
   * Esc with Details open only closes Details: the event is consumed here (document, before it bubbles
   * to the workspace's window listener), so it never also cancels the active draft.
   */
  onEscape(event: Event): void {
    if (!this.detailsOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    this.detailsOpen.set(false);
    this.toggle()?.nativeElement.focus();
  }
}

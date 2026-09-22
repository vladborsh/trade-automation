import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Order } from '@trade-automation/contracts';
import { readJournalExpanded, writeJournalExpanded } from './journal-expanded';
import { JOURNAL_COLUMNS, journalRow } from './journal-row';

/**
 * backtest-app-system-design.md §7.2, §8 — the session's orders by `seq`, read-only. Every figure is
 * the server's; the flags explain trades resolved on bars, SL/TP in one candle and end-of-session
 * closes. Each cell carries the raw server value in `data-value`. With `collapsible` (the workspace,
 * T-043) it starts collapsed behind its header and the choice is remembered per browser; without
 * it (e.g. the stats page) it is always open, with no toggle and no storage read.
 */
@Component({
  selector: 'app-journal',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './journal.component.html',
  styleUrl: './journal.component.scss',
  host: { '[class.collapsed]': '!expanded()' },
})
export class JournalComponent {
  readonly orders = input.required<readonly Order[]>();
  /** For the row links to each trade's detail page (§9.3). */
  readonly sessionId = input.required<string>();
  readonly currency = input.required<string>();
  /** Instrument → price decimals. */
  readonly pricePrecision = input<ReadonlyMap<string, number>>(new Map());
  /** Instrument → the unit its qty is in (T-054, D12). */
  readonly units = input<ReadonlyMap<string, string>>(new Map());
  /** T-043: a toggle header, collapsed by default and remembered; off by default (always open). */
  readonly collapsible = input(false);

  /** The user's click this page; `null` until they toggle, then the stored choice applies. */
  private readonly toggled = signal<boolean | null>(null);
  readonly expanded = computed(() => !this.collapsible() || (this.toggled() ?? readJournalExpanded()));
  readonly columns = JOURNAL_COLUMNS;
  readonly rows = computed(() =>
    this.orders().map((o) => journalRow(o, this.pricePrecision().get(o.instrument), this.currency(), this.units().get(o.instrument))),
  );

  toggle(): void {
    const open = !this.expanded();
    this.toggled.set(open);
    writeJournalExpanded(open);
  }
}

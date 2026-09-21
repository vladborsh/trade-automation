import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Order } from '@trade-automation/contracts';
import { JOURNAL_COLUMNS, journalRow } from './journal-row';

/**
 * backtest-app-system-design.md §7.2, §8 — the session's orders by `seq`, read-only. Every figure is
 * the server's; the flags explain trades resolved on bars, SL/TP in one candle and end-of-session
 * closes. Each cell carries the raw server value in `data-value`.
 */
@Component({
  selector: 'app-journal',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './journal.component.html',
  styleUrl: './journal.component.scss',
})
export class JournalComponent {
  readonly orders = input.required<readonly Order[]>();
  /** For the row links to each trade's detail page (§9.3). */
  readonly sessionId = input.required<string>();
  readonly currency = input.required<string>();
  /** Instrument → price decimals. */
  readonly pricePrecision = input<ReadonlyMap<string, number>>(new Map());

  readonly columns = JOURNAL_COLUMNS;
  readonly rows = computed(() =>
    this.orders().map((o) => journalRow(o, this.pricePrecision().get(o.instrument), this.currency())),
  );
}

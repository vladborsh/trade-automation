import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Order, Session, SessionStatsResponse } from '@trade-automation/contracts';
import { BacktestClient } from '../../core/api/backtest.client';
import { EquityChartComponent } from './equity-chart.component';
import { type EquityUnit, breakdownRows, fullStatsItems, maeItems, rHistogram } from './stats-full';

/**
 * backtest-app-system-design.md §8 — `/sessions/:id/stats`: the full statistics of a session, read
 * only. Everything is `GET …/stats`.computed (decisions 5, 38); the R distribution bins the server's
 * `pnlR` of the closed orders. A route rather than a workspace tab: it opens a complete session from
 * the list without starting the replay engine, and it is its own lazy chunk. Captions are in plain
 * Russian — this screen is read by the trader (PROJECT.md "Communicating with the user").
 */
@Component({
  selector: 'app-stats-full',
  standalone: true,
  imports: [RouterLink, EquityChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stats-full.component.html',
  styleUrl: './stats-full.component.scss',
})
export class StatsFullComponent {
  /** The `:id` route parameter. */
  readonly id = input.required<string>();

  private readonly client = inject(BacktestClient);

  readonly session = signal<Session | null>(null);
  readonly response = signal<SessionStatsResponse | null>(null);
  readonly closed = signal<readonly Order[]>([]);
  readonly error = signal<string | null>(null);
  readonly unit = signal<EquityUnit>('ccy');

  readonly stats = computed(() => this.response()?.computed ?? null);
  private readonly ccy = computed(() => this.session()?.sessionCurrency ?? '');
  readonly headline = computed(() => {
    const s = this.stats();
    return s ? fullStatsItems(s, this.ccy()) : [];
  });
  readonly mae = computed(() => {
    const s = this.stats();
    return s ? maeItems(s) : [];
  });
  readonly byInstrument = computed(() => breakdownRows('byInstrument', this.stats()?.byInstrument ?? {}, this.ccy()));
  readonly bySide = computed(() => breakdownRows('bySide', this.stats()?.bySide ?? {}, this.ccy()));
  readonly histogram = computed(() => rHistogram(this.closed().map((o) => o.pnlR).filter((r): r is number => r !== null)));
  readonly histogramMax = computed(() => Math.max(1, ...this.histogram().map((b) => b.count)));

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
  }

  private async load(id: string): Promise<void> {
    this.error.set(null);
    try {
      const [{ session }, stats, closed] = await Promise.all([
        this.client.getSession(id),
        this.client.getStats(id),
        this.client.listOrders(id, 'closed'),
      ]);
      this.session.set(session);
      this.response.set(stats);
      this.closed.set(closed);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    }
  }
}

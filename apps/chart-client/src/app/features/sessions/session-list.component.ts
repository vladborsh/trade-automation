import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { SessionSummary } from '@trade-automation/contracts';
import { BacktestClient } from '../../core/api/backtest.client';
import { AppNavComponent } from '../nav/app-nav.component';
import { formatMoney, formatPeriod, formatPnl, formatR, layoutInstruments } from './session-format';
import { deleteSessionErrorMessage, loadErrorMessage } from './session-messages';

/**
 * backtest-app-system-design.md §2.3, §7.2 — `/sessions` (the default route): the user's
 * sessions from the stored aggregates (decision 38), with open and delete. Delete asks first and
 * says what goes with the session (decision 30b); it cannot be undone.
 */
@Component({
  selector: 'app-session-list',
  standalone: true,
  imports: [AppNavComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './session-list.component.html',
  styleUrl: './session-list.component.scss',
})
export class SessionListComponent implements OnInit {
  private readonly backtest = inject(BacktestClient);

  readonly sessions = signal<SessionSummary[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  /** The session whose delete is awaiting confirmation. */
  readonly confirming = signal<string | null>(null);
  readonly deleting = signal<string | null>(null);
  readonly deleteError = signal<{ id: string; message: string } | null>(null);

  readonly period = (s: SessionSummary) => formatPeriod(s.periodFromMs, s.periodToMs);
  readonly instruments = (s: SessionSummary) => layoutInstruments(s.layout);
  readonly balance = (s: SessionSummary) => formatMoney(s.balance, s.sessionCurrency);
  readonly pnl = (s: SessionSummary) => formatPnl(s.pnlCcy, s.sessionCurrency);
  readonly pnlR = (s: SessionSummary) => formatR(s.pnlR);

  async ngOnInit(): Promise<void> {
    try {
      this.sessions.set(await this.backtest.listSessions());
    } catch (err) {
      this.loadError.set(loadErrorMessage(err, 'sessions'));
    } finally {
      this.loading.set(false);
    }
  }

  askDelete(id: string): void {
    this.deleteError.set(null);
    this.confirming.set(id);
  }

  cancelDelete(): void {
    this.confirming.set(null);
  }

  async confirmDelete(id: string): Promise<void> {
    this.deleting.set(id);
    try {
      await this.backtest.deleteSession(id);
      this.sessions.update((list) => list.filter((s) => s.id !== id));
      this.confirming.set(null);
    } catch (err) {
      this.deleteError.set({ id, message: deleteSessionErrorMessage(err) });
    } finally {
      this.deleting.set(null);
    }
  }
}

import { ChangeDetectionStrategy, Component, type OnDestroy, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { OrderDetail, Session } from '@trade-automation/contracts';
import { BacktestClient } from '../../core/api/backtest.client';
import { viewAtFor } from '../../core/replay/view-only';
import { modificationText, tradeDetailFields } from './trade-detail-fields';

type ShotKind = 'entry' | 'exit';

/**
 * backtest-app-system-design.md §9.3 — `/sessions/:id/trades/:orderId`: the order row, its costs,
 * R and MAE, the modification history and both screenshots (placeholders until T-026 uploads
 * them). "Show on chart" opens the workspace view-only at the trade (decision 32). Read-only.
 */
@Component({
  selector: 'app-trade-detail',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './trade-detail.component.html',
  styleUrl: './trade-detail.component.scss',
})
export class TradeDetailComponent implements OnDestroy {
  /** The `:id` and `:orderId` route parameters. */
  readonly id = input.required<string>();
  readonly orderId = input.required<string>();

  private readonly client = inject(BacktestClient);

  readonly session = signal<Session | null>(null);
  readonly detail = signal<OrderDetail | null>(null);
  readonly precision = signal<number | undefined>(undefined);
  readonly error = signal<string | null>(null);
  /** Object URLs of the fetched screenshots; null = none (placeholder). */
  readonly shots = signal<Record<ShotKind, string | null>>({ entry: null, exit: null });

  readonly fields = computed(() => {
    const d = this.detail();
    const s = this.session();
    return d && s ? tradeDetailFields(d.order, s.sessionCurrency, this.precision()) : [];
  });
  readonly modifications = computed(() => (this.detail()?.modifications ?? []).map((m) => modificationText(m, this.precision())));
  /** Query params for "Show on chart" (§9.3). */
  readonly showOnChart = computed(() => {
    const order = this.detail()?.order;
    return order ? { viewAt: viewAtFor(order), order: order.id } : null;
  });

  constructor() {
    effect(() => {
      const id = this.id();
      const orderId = this.orderId();
      untracked(() => void this.load(id, orderId));
    });
  }

  ngOnDestroy(): void {
    this.releaseShots();
  }

  private async load(id: string, orderId: string): Promise<void> {
    this.error.set(null);
    this.releaseShots();
    try {
      const [{ session }, detail, instruments] = await Promise.all([
        this.client.getSession(id),
        this.client.getOrder(id, orderId),
        this.client.getInstruments(),
      ]);
      this.session.set(session);
      this.precision.set(instruments.find((i) => i.id === detail.order.instrument)?.pricePrecision);
      this.detail.set(detail);
      const [entry, exit] = await Promise.all([this.shot(detail.screenshots.entry), this.shot(detail.screenshots.exit)]);
      this.shots.set({ entry, exit });
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    }
  }

  private async shot(path: string | undefined): Promise<string | null> {
    if (!path) return null;
    const blob = await this.client.fetchScreenshot(path);
    return blob ? URL.createObjectURL(blob) : null;
  }

  private releaseShots(): void {
    for (const url of Object.values(this.shots())) if (url) URL.revokeObjectURL(url);
    this.shots.set({ entry: null, exit: null });
  }
}

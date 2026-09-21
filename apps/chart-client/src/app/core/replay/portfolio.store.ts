import { computed, signal } from '@angular/core';
import type { FillEvent, Order, SessionDetail, SessionStats } from '@trade-automation/contracts';
import { previewDiffers } from './reconcile';

/**
 * backtest-app-system-design.md §2.3, §5.4–5.5 — the session's orders, fill events and server
 * statistics as the client knows them. A skeleton for T-023 (order panel, previews) and T-024
 * (positions): today it only holds what the server returns. Server rows always replace local
 * state; where T-023 will have put a preview first, a disagreement is reported (never kept).
 *
 * Framework-free apart from its signals.
 */
export class PortfolioStore {
  private readonly byId = signal<ReadonlyMap<string, Order>>(new Map());
  private readonly previews = new Map<string, Order>();

  /** Every known order, by `seq` (the journal order). */
  readonly orders = computed(() => [...this.byId().values()].sort((a, b) => a.seq - b.seq));
  readonly events = signal<readonly FillEvent[]>([]);
  readonly stats = signal<SessionStats | null>(null);

  /** The state `GET …/sessions/:id` returns — the reload and resync source. */
  load(detail: SessionDetail): void {
    this.byId.set(new Map(detail.openOrders.map((o) => [o.id, o])));
    this.previews.clear();
    this.events.set([]);
    this.stats.set(detail.stats);
  }

  /** T-023: the client's own prediction for an order, to be checked against the server's row. */
  setPreview(order: Order): void {
    this.previews.set(order.id, order);
  }

  /**
   * Server rows replace local ones. Returns, per order whose preview disagreed, the fields that
   * differed — the caller logs them and shows the "resynced" notice.
   */
  applyOrders(orders: readonly Order[]): Array<{ orderId: string; fields: string[] }> {
    const mismatches: Array<{ orderId: string; fields: string[] }> = [];
    if (orders.length === 0) return mismatches;
    const next = new Map(this.byId());
    for (const order of orders) {
      const preview = this.previews.get(order.id);
      if (preview) {
        const fields = previewDiffers(preview, order);
        if (fields.length > 0) mismatches.push({ orderId: order.id, fields });
        this.previews.delete(order.id);
      }
      next.set(order.id, order);
    }
    this.byId.set(next);
    return mismatches;
  }

  applyEvents(events: readonly FillEvent[]): void {
    if (events.length > 0) this.events.update((all) => [...all, ...events]);
  }
}

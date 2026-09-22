import { signal } from '@angular/core';
import type { Order } from '@trade-automation/contracts';

/** One closed trade, as the snackbar shows it. */
export interface CloseNotice {
  /** Unique per notice (for tracking and dismissing). */
  id: number;
  orderId: string;
  seq: number;
  instrument: Order['instrument'];
  side: Order['side'];
  reason: NonNullable<Order['closeReason']>;
  pnlCcy: number | null;
  pnlR: number | null;
}

/**
 * T-051 (the user's feedback, item 17) — the trades the server closed while the user watched: one
 * notice per closed order, never per response (a coalesced answer with two exits gives two; a
 * replayed answer or a later row update of the same order gives none). Orders already closed when
 * the session was loaded are history: `remember` marks them, so a reload never announces them.
 */
export class CloseNotices {
  readonly notices = signal<readonly CloseNotice[]>([]);
  private readonly seen = new Set<string>();
  private next = 1;

  /** The loaded journal: whatever is closed there already is not news. */
  remember(orders: readonly Order[]): void {
    for (const o of orders) if (o.status === 'closed') this.seen.add(o.id);
  }

  /** Orders from the server's answer that it closed; returns how many were new (0 = no sound). */
  closed(orders: readonly Order[]): number {
    const fresh = orders.filter((o) => o.status === 'closed' && o.closeReason !== null && !this.seen.has(o.id));
    if (fresh.length === 0) return 0;
    for (const o of fresh) this.seen.add(o.id);
    this.notices.update((list) => [
      ...list,
      ...fresh.map((o) => ({
        id: this.next++,
        orderId: o.id,
        seq: o.seq,
        instrument: o.instrument,
        side: o.side,
        reason: o.closeReason!,
        pnlCcy: o.pnlCcy,
        pnlR: o.pnlR,
      })),
    ]);
    return fresh.length;
  }

  dismiss(id: number): void {
    this.notices.update((list) => list.filter((n) => n.id !== id));
  }
}

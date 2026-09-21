import { computed, signal } from '@angular/core';
import type { Costs, FillEvent, Order, SessionDetail, SessionStats, SessionStatsResponse } from '@trade-automation/contracts';
import type { PathBar } from '@trade-automation/replay-core';
import { previewStep } from './order-preview';
import { previewDiffers } from './reconcile';

type Mismatch = { orderId: string; fields: string[] };

/** One step's preview of an order, with the state it replaced (for when the server disagrees). */
interface StepPreview {
  cursorMs: number;
  order: Order;
  before: Order;
}

/**
 * backtest-app-system-design.md §2.3, §5.4–5.5 — the session's orders, fill events and server
 * statistics as the client knows them. Server rows always replace local state; where a preview
 * came first, a disagreement is reported (never kept).
 *
 * T-023 previews: each step runs replay-core over the revealed 1m (`previewStep`), so the orders
 * shown flip before the server answers. Previews are logged per cursor: an advance's answer is
 * compared with the preview made at or before its cursor, while a newer preview (a step taken
 * since) stays on display. An order the answer does not mention, but a preview changed, is a
 * disagreement too: the server saw nothing happen, so the pre-preview state is shown again.
 *
 * Framework-free apart from its signals.
 */
export class PortfolioStore {
  private readonly byId = signal<ReadonlyMap<string, Order>>(new Map());
  private readonly previews = new Map<string, Order>();
  private readonly stepPreviews = new Map<string, StepPreview[]>();
  /** Orders with a cancel or close on its way: the preview leaves them alone. */
  private readonly pendingOps = new Set<string>();

  /** Every known order, by `seq` (the journal order). */
  readonly orders = computed(() => [...this.byId().values()].sort((a, b) => a.seq - b.seq));
  readonly events = signal<readonly FillEvent[]>([]);
  readonly stats = signal<SessionStats | null>(null);
  /** `GET …/stats`: the stored aggregates differ from a full recompute (decision 38). */
  readonly drift = signal(false);

  /** The state `GET …/sessions/:id` returns — the reload and resync source. */
  load(detail: SessionDetail): void {
    this.byId.set(new Map(detail.openOrders.map((o) => [o.id, o])));
    this.previews.clear();
    this.stepPreviews.clear();
    this.pendingOps.clear();
    this.events.set([]);
    this.stats.set(detail.stats);
  }

  /** Every order of the session (`GET …/orders`), replacing what was known: the journal's source. */
  setOrders(orders: readonly Order[]): void {
    this.byId.set(new Map(orders.map((o) => [o.id, o])));
    this.stepPreviews.clear();
  }

  /**
   * One step (T-023): previews every pending/open order over the 1m the step revealed and shows the
   * result at once. Returns the previewed fill events.
   */
  previewStep(cursorMs: number, revealed: ReadonlyMap<string, readonly PathBar[]>, costs: Costs): FillEvent[] {
    const current = this.byId();
    const { orders, events } = previewStep([...current.values()], revealed, costs, this.pendingOps);
    if (orders.length > 0) {
      const next = new Map(current);
      for (const order of orders) {
        next.set(order.id, order);
        const log = this.stepPreviews.get(order.id) ?? [];
        log.push({ cursorMs, order, before: current.get(order.id)! });
        this.stepPreviews.set(order.id, log);
      }
      this.byId.set(next);
    }
    return events;
  }

  /**
   * An advance's answer: its rows replace the previews made up to its cursor (compared field by
   * field); newer previews stay shown. Returns the disagreements.
   */
  applyAdvance(cursorMs: number, orders: readonly Order[]): Mismatch[] {
    const mismatches: Mismatch[] = [];
    const next = new Map(this.byId());
    const answered = new Set(orders.map((o) => o.id));
    for (const order of orders) {
      const log = this.stepPreviews.get(order.id) ?? [];
      const upTo = log.filter((p) => p.cursorMs <= cursorMs);
      const later = log.filter((p) => p.cursorMs > cursorMs);
      const preview = upTo.at(-1)?.order ?? this.previews.get(order.id);
      this.previews.delete(order.id);
      const fields = preview ? previewDiffers(preview, order) : [];
      if (fields.length > 0) mismatches.push({ orderId: order.id, fields });
      if (later.length > 0 && fields.length === 0) {
        this.stepPreviews.set(order.id, later);
        next.set(order.id, later.at(-1)!.order);
      } else {
        this.stepPreviews.delete(order.id); // a disagreement voids the previews built on it
        next.set(order.id, order);
      }
    }
    for (const [id, log] of this.stepPreviews) {
      if (answered.has(id) || !log.some((p) => p.cursorMs <= cursorMs)) continue;
      // previewed up to this advance, yet the server touched nothing: it saw no fill or exit
      const first = log[0];
      mismatches.push({ orderId: id, fields: previewDiffers(log.filter((p) => p.cursorMs <= cursorMs).at(-1)!.order, first.before) });
      this.stepPreviews.delete(id);
      next.set(id, first.before);
    }
    this.byId.set(next);
    return mismatches;
  }

  /** A cancel or close for this order was queued: previews leave it alone until the answer. */
  markPending(orderId: string): void {
    this.pendingOps.add(orderId);
    this.stepPreviews.delete(orderId);
  }

  clearPending(orderId: string): void {
    this.pendingOps.delete(orderId);
  }

  /** `GET …/stats`: the server's recompute is what the summary shows; `drift` flags the stored row. */
  applyStatsResponse(res: SessionStatsResponse): void {
    this.stats.set(res.computed);
    this.drift.set(res.drift);
  }

  /** T-023: the client's own prediction for an order, to be checked against the server's row. */
  setPreview(order: Order): void {
    this.previews.set(order.id, order);
  }

  /**
   * Server rows replace local ones. Returns, per order whose preview disagreed, the fields that
   * differed — the caller logs them and shows the "resynced" notice.
   */
  applyOrders(orders: readonly Order[]): Mismatch[] {
    const mismatches: Mismatch[] = [];
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

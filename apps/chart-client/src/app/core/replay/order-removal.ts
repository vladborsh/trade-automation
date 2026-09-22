import type { Order } from '@trade-automation/contracts';

/** What removing a live order's tool does, and how the confirm asks (BUG-017). */
export interface OrderRemoval {
  orderId: string;
  seq: number;
  action: 'cancel' | 'close';
  question: string;
  confirmLabel: string;
}

/**
 * BUG-017 (Tech Lead ruling): deleting a live order's tool is the order's own action, never just
 * hiding the drawing — a pending order is cancelled, an open position closed at market — and it is
 * asked first, since a key press must never close a position outright. Null for any other status
 * (a closed or cancelled order has no tool to delete).
 */
export function orderRemoval(order: Pick<Order, 'id' | 'seq' | 'status'>): OrderRemoval | null {
  if (order.status === 'pending') {
    return { orderId: order.id, seq: order.seq, action: 'cancel', question: `Cancel order #${order.seq}?`, confirmLabel: 'Cancel order' };
  }
  if (order.status === 'open') {
    return { orderId: order.id, seq: order.seq, action: 'close', question: `Close position #${order.seq} at market?`, confirmLabel: 'Close position' };
  }
  return null;
}

import type { Order } from '@trade-automation/contracts';
import { orderRemoval } from './order-removal';

describe('orderRemoval (BUG-017)', () => {
  it('a pending order is cancelled; an open position is closed at market — each asked first', () => {
    expect(orderRemoval({ id: 'a', seq: 3, status: 'pending' })).toEqual({
      orderId: 'a', seq: 3, action: 'cancel', question: 'Cancel order #3?', confirmLabel: 'Cancel order',
    });
    expect(orderRemoval({ id: 'b', seq: 4, status: 'open' })).toEqual({
      orderId: 'b', seq: 4, action: 'close', question: 'Close position #4 at market?', confirmLabel: 'Close position',
    });
  });

  it('nothing for an order that is already over', () => {
    for (const status of ['closed', 'cancelled'] as Order['status'][]) expect(orderRemoval({ id: 'c', seq: 5, status })).toBeNull();
  });
});

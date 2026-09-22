import type { Order } from '@trade-automation/contracts';
import { CloseNotices } from './close-notices';

const order = (over: Partial<Order>): Order =>
  ({ id: 'o1', seq: 1, instrument: 'binance:BTCUSDT', side: 'long', status: 'closed', closeReason: 'stop', pnlCcy: -100, pnlR: -1, ...over }) as Order;

describe('CloseNotices (T-051)', () => {
  it('one notice per closed order: two exits in one answer are two notices', () => {
    const n = new CloseNotices();
    expect(n.closed([order({}), order({ id: 'o2', seq: 2, closeReason: 'take-profit', pnlCcy: 200, pnlR: 2 })])).toBe(2);
    expect(n.notices().map((x) => [x.seq, x.reason, x.pnlCcy, x.pnlR])).toEqual([
      [1, 'stop', -100, -1],
      [2, 'take-profit', 200, 2],
    ]);
  });

  it('never twice for the same order (a replayed answer, a later row update)', () => {
    const n = new CloseNotices();
    n.closed([order({})]);
    expect(n.closed([order({})])).toBe(0);
    expect(n.notices()).toHaveLength(1);
  });

  it('orders still open or pending are not news; the loaded journal’s closed trades never are', () => {
    const n = new CloseNotices();
    n.remember([order({ id: 'old' }), order({ id: 'live', status: 'open', closeReason: null })]);
    expect(n.closed([order({ id: 'old' }), order({ id: 'p', status: 'pending', closeReason: null })])).toBe(0);
    expect(n.closed([order({ id: 'live' })])).toBe(1); // it was open at load; it closed now
  });

  it('manual and end-of-session closes are notices too; dismiss removes one', () => {
    const n = new CloseNotices();
    n.closed([order({ id: 'm', closeReason: 'manual' }), order({ id: 'e', closeReason: 'end-of-session' })]);
    const [first] = n.notices();
    n.dismiss(first.id);
    expect(n.notices().map((x) => x.reason)).toEqual(['end-of-session']);
  });
});

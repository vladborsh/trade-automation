import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Order } from '@trade-automation/contracts';
import { JournalComponent } from './journal.component';

const order = (id: string, seq: number, extra: Partial<Order> = {}) =>
  ({
    id, seq, instrument: 'binance:BTCUSDT', side: 'long', type: 'market', status: 'closed', placedAtMs: 0, entryPrice: 100,
    entryTimeMs: 0, exitPrice: 110, exitTimeMs: 60_000, closeReason: 'take-profit', qty: 1, commissionCcy: 0.1, spreadCostCcy: 0.05,
    pnlCcy: 9.85, pnlR: 1.97, maeR: 0.2, fillResolution: '1m', slTpSameBar: false, slInitial: 95, slCurrent: 95, ...extra,
  }) as Order;

function render(orders: Order[]) {
  TestBed.configureTestingModule({ imports: [JournalComponent], providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(JournalComponent);
  fixture.componentRef.setInput('orders', orders);
  fixture.componentRef.setInput('currency', 'USD');
  fixture.componentRef.setInput('sessionId', 's1');
  fixture.componentRef.setInput('pricePrecision', new Map([['binance:BTCUSDT', 1]]));
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('JournalComponent', () => {
  it('one row per order, in the order given (by seq), with raw values on every cell', () => {
    const { el } = render([order('a', 1), order('b', 2, { pnlCcy: -5, pnlR: -1 })]);
    const rows = el.querySelectorAll('[data-testid="journal-row"]');
    expect([...rows].map((r) => r.getAttribute('data-order-id'))).toEqual(['a', 'b']);
    const entry = rows[0].querySelector('[data-field="entryPrice"]')!;
    expect(entry.textContent?.trim()).toBe('100.0');
    expect(rows[1].querySelector('[data-field="seq"] a')?.getAttribute('href')).toBe('/sessions/s1/trades/b');
    expect(entry.getAttribute('data-value')).toBe('100');
    expect(rows[0].classList.contains('win')).toBe(true);
    expect(rows[1].classList.contains('loss')).toBe(true);
  });

  it('shows each flag with its explanation', () => {
    const { el } = render([order('a', 1, { fillResolution: 'pessimistic-bar', slTpSameBar: true, closeReason: 'end-of-session' })]);
    const flags = [...el.querySelectorAll('.flag')].map((f) => [f.getAttribute('data-flag'), f.getAttribute('title')]);
    expect(flags).toEqual([
      ['pessimistic-bar', 'Resolved on bars, not 1m: stop assumed first'],
      ['sl-tp-same-bar', 'SL and TP in one candle — stop taken'],
      ['end-of-session', 'Closed at the end of the session, at the last price'],
    ]);
  });

  it('says so when there are no orders', () => {
    expect(render([]).el.textContent).toContain('No orders yet.');
  });
});

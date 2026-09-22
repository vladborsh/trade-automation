import { TestBed } from '@angular/core/testing';
import type { Order } from '@trade-automation/contracts';
import { PositionsPanelComponent } from './positions-panel.component';
import type { PositionRow } from './positions.view';

const order = (over: Partial<Order>) => ({ id: 'o1', seq: 1, instrument: 'binance:BTCUSDT', side: 'long', status: 'open', slCurrent: 99, tpCurrent: 102, ...over }) as Order;
const ROWS: PositionRow[] = [
  { order: order({ id: 'a', seq: 1 }), entry: 100.25, floating: 12.5, risk: 100 },
  { order: order({ id: 'b', seq: 2, status: 'pending', side: 'short', tpCurrent: null }), entry: 101, floating: null, risk: 50 },
];

function render(rows: PositionRow[] = ROWS) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [PositionsPanelComponent] });
  const fixture = TestBed.createComponent(PositionsPanelComponent);
  fixture.componentRef.setInput('rows', rows);
  fixture.componentRef.setInput('currency', 'USD');
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('PositionsPanelComponent (T-023)', () => {
  it('lists pending and open orders with floating PnL (open only) and risk', () => {
    const { el } = render();
    const open = el.querySelector('[data-testid="position-1"]')!;
    expect(open.textContent!.replace(/\s+/g, ' ')).toContain('100.25');
    expect(open.querySelector('[data-testid="position-instrument"]')!.textContent).toBe('binance:BTCUSDT'); // T-046
    expect(open.querySelector('[data-testid="position-pnl"]')!.textContent!.trim()).toBe('+12.50 USD');
    const pending = el.querySelector('[data-testid="position-2"]')!;
    expect(pending.getAttribute('data-status')).toBe('pending');
    expect(pending.querySelector('[data-testid="position-pnl"]')!.textContent!.trim()).toBe('—');
  });

  it('cancel for pending, close for open', () => {
    const { fixture, el } = render();
    const cancelled: string[] = [];
    const closed: string[] = [];
    fixture.componentInstance.cancel.subscribe((id) => cancelled.push(id));
    fixture.componentInstance.close.subscribe((id) => closed.push(id));
    el.querySelector<HTMLButtonElement>('[data-testid="position-1"] button')!.click();
    el.querySelector<HTMLButtonElement>('[data-testid="position-2"] button')!.click();
    expect(closed).toEqual(['a']);
    expect(cancelled).toEqual(['b']);
  });

  it('empty state', () => {
    expect(render([]).el.textContent).toContain('No pending or open orders.');
  });
});

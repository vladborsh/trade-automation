import { TestBed } from '@angular/core/testing';
import type { Order } from '@trade-automation/contracts';
import { PositionsDropdownComponent } from './positions-dropdown.component';
import type { PositionRow } from './positions.view';

const order = (over: Partial<Order>) => ({ id: 'o1', seq: 1, instrument: 'binance:BTCUSDT', side: 'long', status: 'open', slCurrent: 99, tpCurrent: 102, ...over }) as Order;
const ROWS: PositionRow[] = [
  { order: order({ id: 'a', seq: 1 }), entry: 100.25, floating: 12.5, risk: 100 },
  { order: order({ id: 'b', seq: 2, status: 'pending', side: 'short', instrument: 'capitalcom:US100' }), entry: 101, floating: null, risk: 50 },
];

function render(rows: PositionRow[] = ROWS) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [PositionsDropdownComponent] });
  const fixture = TestBed.createComponent(PositionsDropdownComponent);
  fixture.componentRef.setInput('rows', rows);
  fixture.componentRef.setInput('currency', 'USD');
  fixture.detectChanges();
  document.body.appendChild(fixture.nativeElement); // for the click-outside check
  const el = fixture.nativeElement as HTMLElement;
  const toggle = () => el.querySelector<HTMLButtonElement>('[data-testid="positions-toggle"]')!;
  const dropdown = () => el.querySelector('[data-testid="positions-dropdown"]');
  return { fixture, el, toggle, dropdown };
}

describe('PositionsDropdownComponent (T-046)', () => {
  afterEach(() => document.body.querySelectorAll('app-positions-dropdown').forEach((n) => n.remove()));

  it('is a toolbar button with the count of open and pending orders, closed by default', () => {
    const { toggle, dropdown } = render();
    expect(toggle().textContent).toContain('Positions');
    expect(toggle().querySelector('[data-testid="positions-count"]')!.textContent).toBe('2');
    expect(toggle().title).toBe('1 open, 1 pending');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(dropdown()).toBeNull();
  });

  it('opens the list on click: instrument, direction, PnL and the actions', () => {
    const { fixture, toggle, dropdown } = render();
    toggle().click();
    fixture.detectChanges();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    const rows = dropdown()!.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[1].querySelector('[data-testid="position-instrument"]')!.textContent).toBe('capitalcom:US100');
    expect(rows[1].textContent).toContain('short');
    expect(rows[0].querySelector('[data-testid="position-pnl"]')!.textContent!.trim()).toBe('+12.50 USD');
  });

  it('passes cancel and close on, and stays open for the next one', () => {
    const { fixture, toggle, dropdown } = render();
    const cancelled: string[] = [];
    const closed: string[] = [];
    fixture.componentInstance.cancel.subscribe((id) => cancelled.push(id));
    fixture.componentInstance.close.subscribe((id) => closed.push(id));
    toggle().click();
    fixture.detectChanges();
    dropdown()!.querySelector<HTMLButtonElement>('[data-testid="position-1"] button')!.click();
    dropdown()!.querySelector<HTMLButtonElement>('[data-testid="position-2"] button')!.click();
    fixture.detectChanges();
    expect(closed).toEqual(['a']);
    expect(cancelled).toEqual(['b']);
    expect(dropdown()).not.toBeNull();
  });

  it('closes on a second click, a click outside, and Esc inside it', () => {
    const { fixture, toggle, dropdown } = render();
    toggle().click();
    fixture.detectChanges();
    toggle().click();
    fixture.detectChanges();
    expect(dropdown()).toBeNull();

    toggle().click();
    fixture.detectChanges();
    document.body.click();
    fixture.detectChanges();
    expect(dropdown()).toBeNull();

    toggle().click();
    fixture.detectChanges();
    dropdown()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(dropdown()).toBeNull();
  });

  it('with nothing open or pending: a count of 0 and an empty list', () => {
    const { fixture, toggle, dropdown } = render([]);
    expect(toggle().querySelector('[data-testid="positions-count"]')!.textContent).toBe('0');
    toggle().click();
    fixture.detectChanges();
    expect(dropdown()!.textContent).toContain('No pending or open orders.');
  });

  it('a mouse click hands focus back to the page (hotkeys act at once); a keyboard toggle keeps it', () => {
    const { fixture, toggle } = render();
    toggle().focus();
    toggle().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })); // a mouse click
    fixture.detectChanges();
    expect(document.activeElement).not.toBe(toggle());
    toggle().focus();
    toggle().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })); // Enter / Space on the button
    fixture.detectChanges();
    expect(document.activeElement).toBe(toggle());
  });
});

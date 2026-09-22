import { TestBed } from '@angular/core/testing';
import type { OrderRemoval } from '../../core/replay/order-removal';
import { OrderRemoveConfirmComponent } from './order-remove-confirm.component';

const CLOSE: OrderRemoval = { orderId: 'o1', seq: 4, action: 'close', question: 'Close position #4 at market?', confirmLabel: 'Close position' };

function render(removal: OrderRemoval = CLOSE) {
  TestBed.configureTestingModule({ imports: [OrderRemoveConfirmComponent] });
  const fixture = TestBed.createComponent(OrderRemoveConfirmComponent);
  fixture.componentRef.setInput('removal', removal);
  fixture.detectChanges();
  const got = { confirms: 0, dismisses: 0 };
  fixture.componentInstance.confirm.subscribe(() => got.confirms++);
  fixture.componentInstance.dismiss.subscribe(() => got.dismisses++);
  return { el: fixture.nativeElement as HTMLElement, got };
}

describe('OrderRemoveConfirmComponent (BUG-017)', () => {
  it('asks the question with the action on its confirm button', () => {
    const { el } = render();
    expect(el.querySelector('[data-testid="remove-confirm"]')!.getAttribute('role')).toBe('alertdialog');
    expect(el.querySelector('[data-testid="remove-confirm-question"]')!.textContent).toBe('Close position #4 at market?');
    expect(el.querySelector('[data-testid="remove-confirm-button"]')!.textContent).toContain('Close position');
  });

  it('Confirm (a submit — also Enter) confirms; Keep, Esc and a click outside dismiss', () => {
    const { el, got } = render();
    el.querySelector<HTMLFormElement>('form')!.requestSubmit(el.querySelector<HTMLButtonElement>('[data-testid="remove-confirm-button"]')!);
    el.querySelector<HTMLButtonElement>('[data-testid="remove-keep"]')!.click();
    el.querySelector('form')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    el.querySelector<HTMLElement>('[data-testid="remove-confirm-backdrop"]')!.click();
    expect(got).toEqual({ confirms: 1, dismisses: 3 });
  });
});

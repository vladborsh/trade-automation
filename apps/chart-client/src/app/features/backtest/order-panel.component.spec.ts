import { TestBed } from '@angular/core/testing';
import type { PositionToolState } from '../chart/overlay/position-tool.model';
import { OrderPanelComponent } from './order-panel.component';

const DRAFT: PositionToolState = { id: 't1', side: 'long', mode: 'limit', entry: 100, sl: 99, tp: 102, kind: 'draft', active: true, anchorTime: 0 };

function render(inputs: { draft?: PositionToolState | null; multiple?: number } = {}) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [OrderPanelComponent] });
  const fixture = TestBed.createComponent(OrderPanelComponent);
  const set = fixture.componentRef.setInput.bind(fixture.componentRef);
  set('draft', inputs.draft === undefined ? DRAFT : inputs.draft);
  set('lastClose', 100.5);
  set('balance', 10_000);
  set('riskPct', 1);
  set('notionalWarnMultiple', inputs.multiple ?? 5);
  set('currency', 'USD');
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('OrderPanelComponent (T-023; a popup since T-045)', () => {
  it("shows the active draft's size, 1R, reward and notional", () => {
    const { el } = render();
    const text = el.querySelector('[data-testid="order-panel"]')!.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('long limit @ 100.00');
    expect(el.querySelector('[data-testid="order-qty"]')!.textContent).toBe('100.000');
    expect(text).toContain('100.00 USD'); // 1R
    expect(text).toContain('2.00 R');
    expect(text).toContain('10,000.00 USD'); // notional
    expect(el.querySelector('[data-testid="notional-warning"]')).toBeNull();
  });

  it('warns when the notional is above balance × multiple', () => {
    const { el } = render({ draft: { ...DRAFT, sl: 99.9 } }); // qty ≈ 1 000, notional ≈ 100 000 > 50 000
    expect(el.querySelector('[data-testid="notional-warning"]')?.textContent).toContain('5× the balance');
  });

  it('T-045: a modal dialog with Confirm and Cancel', () => {
    const { el } = render();
    const dialog = el.querySelector('[data-testid="order-popup"]')!;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(el.querySelector('[data-testid="order-confirm"]')?.textContent).toContain('Confirm');
    expect(el.querySelector('[data-testid="order-cancel"]')?.textContent).toContain('Cancel');
  });

  function outputs(fixture: ReturnType<typeof render>['fixture']) {
    const got = { risks: [] as number[], confirms: 0, cancels: 0 };
    fixture.componentInstance.riskPctChange.subscribe((v) => got.risks.push(v));
    fixture.componentInstance.confirm.subscribe(() => got.confirms++);
    fixture.componentInstance.cancel.subscribe(() => got.cancels++);
    return got;
  }

  it('Confirm places; a changed risk % goes out first; a non-positive one is ignored', () => {
    const { fixture, el } = render();
    const got = outputs(fixture);
    const input = el.querySelector<HTMLInputElement>('input[name="riskPct"]')!;
    input.value = '0';
    input.dispatchEvent(new Event('change')); // ignored (and below the field's min, which would block the submit)
    input.value = '0.5';
    input.dispatchEvent(new Event('change'));
    fixture.componentRef.setInput('riskPct', 0.5); // what the workspace does with it
    // what a click on the submit button does in a browser (jsdom does not submit on click; the e2e clicks)
    el.querySelector<HTMLFormElement>('form')!.requestSubmit(el.querySelector<HTMLButtonElement>('[data-testid="order-confirm"]')!);
    expect(got.risks).toEqual([0.5]);
    expect(got.confirms).toBe(1);
  });

  it('Enter in the risk field submits with the value just typed (before its change event)', () => {
    const { fixture, el } = render();
    const got = outputs(fixture);
    el.querySelector<HTMLInputElement>('input[name="riskPct"]')!.value = '2';
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(got.risks).toEqual([2]);
    expect(got.confirms).toBe(1);
  });

  it('Cancel, Esc and a click outside close it', () => {
    const { fixture, el } = render();
    const got = outputs(fixture);
    el.querySelector<HTMLButtonElement>('[data-testid="order-cancel"]')!.click();
    el.querySelector('form')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    el.querySelector<HTMLElement>('[data-testid="order-popup-backdrop"]')!.click();
    expect(got.cancels).toBe(3);
    expect(got.confirms).toBe(0);
  });

  it('a draft with a problem cannot be confirmed: the reason is shown', () => {
    const { fixture, el } = render({ draft: { ...DRAFT, sl: 100 } }); // the stop at the entry: no size
    const got = outputs(fixture);
    expect(el.querySelector('[data-testid="order-problem"]')).not.toBeNull();
    expect(el.querySelector<HTMLButtonElement>('[data-testid="order-confirm"]')!.disabled).toBe(true);
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(got.confirms).toBe(0);
  });
});

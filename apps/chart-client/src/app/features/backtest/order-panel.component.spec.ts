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

describe('OrderPanelComponent (T-023)', () => {
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

  it('no draft: a prompt instead of numbers', () => {
    const { el } = render({ draft: null });
    expect(el.textContent).toContain('No active draft');
    expect(el.querySelector('[data-testid="order-panel"]')).toBeNull();
  });

  it('emits a changed risk % and a place request', () => {
    const { fixture, el } = render();
    const risks: number[] = [];
    let placed = 0;
    fixture.componentInstance.riskPctChange.subscribe((v) => risks.push(v));
    fixture.componentInstance.place.subscribe(() => placed++);
    const input = el.querySelector<HTMLInputElement>('input[name="riskPct"]')!;
    input.value = '0.5';
    input.dispatchEvent(new Event('change'));
    input.value = '0';
    input.dispatchEvent(new Event('change')); // ignored
    el.querySelector<HTMLButtonElement>('.place')!.click();
    expect(risks).toEqual([0.5]);
    expect(placed).toBe(1);
  });
});

import { TestBed } from '@angular/core/testing';
import type { SessionPanel, SessionPanelIndicator } from '@trade-automation/contracts';
import { INDICATOR_CATALOG } from '@trade-automation/indicators';
import { IndicatorPickerComponent } from './indicator-picker.component';

function setup(panel: SessionPanel) {
  TestBed.configureTestingModule({ imports: [IndicatorPickerComponent] });
  const fixture = TestBed.createComponent(IndicatorPickerComponent);
  fixture.componentRef.setInput('panel', panel);
  const emitted: SessionPanelIndicator[][] = [];
  fixture.componentInstance.indicatorsChange.subscribe((v) => emitted.push(v));
  fixture.detectChanges();
  return { fixture, emitted, el: fixture.nativeElement as HTMLElement };
}

const PANEL: SessionPanel = { id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false, indicators: [{ id: 'ema', params: { length: 21 } }] };

describe('IndicatorPickerComponent (T-028)', () => {
  it('offers exactly the libs/indicators catalogue, and lists the panel’s indicators with their params', () => {
    const { el } = setup(PANEL);
    const options = [...el.querySelectorAll('select option')].map((o) => o.textContent?.trim()).slice(1);
    expect(options).toEqual(INDICATOR_CATALOG.map((e) => e.name));
    expect(el.querySelector('[data-testid="indicator-row"] .label')?.textContent?.trim()).toBe('EMA (21)');
    expect(el.querySelector<HTMLInputElement>('[data-testid="indicator-row"] input')!.value).toBe('21');
  });

  it('add emits the list with the catalogue defaults; remove emits it without the row', () => {
    const { fixture, el, emitted } = setup(PANEL);
    const select = el.querySelector<HTMLSelectElement>('select')!;
    select.value = 'macd';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('.add button')!.click();
    expect(emitted.at(-1)).toEqual([PANEL.indicators![0], { id: 'macd', params: { fast: 12, slow: 26, signal: 9 } }]);
    el.querySelector<HTMLButtonElement>('button.remove')!.click();
    expect(emitted.at(-1)).toEqual([]);
  });

  it('a parameter change emits the new params; an out-of-bounds one is refused with a message', () => {
    const { fixture, el, emitted } = setup(PANEL);
    const input = el.querySelector<HTMLInputElement>('[data-testid="indicator-row"] input')!;
    input.value = '9';
    input.dispatchEvent(new Event('change'));
    expect(emitted.at(-1)).toEqual([{ id: 'ema', params: { length: 9 } }]);
    input.value = '0';
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(emitted).toHaveLength(1);
    expect(el.querySelector('[role="alert"]')?.textContent).toMatch(/Length must be a whole number from 1 to 1000/);
  });

  it('an id the catalogue no longer has is shown as unknown and can be removed', () => {
    const { el, emitted } = setup({ ...PANEL, indicators: [{ id: 'no-such-indicator', params: {} }] });
    expect(el.querySelector('[data-testid="indicator-row"] .label')?.textContent?.trim()).toBe('no-such-indicator (unknown)');
    el.querySelector<HTMLButtonElement>('button.remove')!.click();
    expect(emitted.at(-1)).toEqual([]);
  });
});

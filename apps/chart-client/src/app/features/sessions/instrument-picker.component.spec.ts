import { TestBed } from '@angular/core/testing';
import type { InstrumentId } from '@trade-automation/contracts';
import { groupByCurrency } from './instrument-groups';
import { InstrumentPickerComponent } from './instrument-picker.component';
import { CATALOGUE_LIST } from './sessions-test-fixtures';

function setup(selected: InstrumentId[]) {
  TestBed.configureTestingModule({ imports: [InstrumentPickerComponent] });
  const fixture = TestBed.createComponent(InstrumentPickerComponent);
  fixture.componentRef.setInput('groups', groupByCurrency(CATALOGUE_LIST));
  fixture.componentRef.setInput('selected', selected);
  const emitted: InstrumentId[][] = [];
  fixture.componentInstance.selectedChange.subscribe((v) => emitted.push(v));
  fixture.detectChanges();
  return { fixture, emitted, el: fixture.nativeElement as HTMLElement };
}

describe('InstrumentPickerComponent', () => {
  it('shows covered instruments only, under their currency', () => {
    const { el } = setup([]);
    expect([...el.querySelectorAll('legend')].map((l) => l.textContent?.trim())).toEqual(['CHF', 'USD']);
    expect(el.textContent).not.toContain('US Tech 100'); // coverage null
    expect(el.querySelectorAll('input[type="checkbox"]')).toHaveLength(3);
  });

  it('emits the new selection on toggle, across groups too (the form refuses the mix)', () => {
    const { el, emitted } = setup(['binance:BTCUSDT']);
    const boxes = [...el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    const eurchf = boxes[0];
    eurchf.checked = true;
    eurchf.dispatchEvent(new Event('change'));
    expect(emitted.at(-1)).toEqual(['binance:BTCUSDT', 'capitalcom:EURCHF']);
    const btc = boxes.find((b) => b.closest('label')?.textContent?.includes('BTC/USDT'))!;
    btc.checked = false;
    btc.dispatchEvent(new Event('change'));
    expect(emitted.at(-1)).toEqual([]);
  });

  it('disables unchecked boxes once 4 are selected', () => {
    const { el } = setup(['binance:BTCUSDT', 'binance:ETHUSDT', 'binance:X', 'binance:Y'] as InstrumentId[]);
    const eurchf = el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0];
    expect(eurchf.disabled).toBe(true);
  });
});

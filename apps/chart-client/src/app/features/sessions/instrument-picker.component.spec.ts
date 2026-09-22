import { ComponentFixture, TestBed } from '@angular/core/testing';
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
  fixture.componentInstance.selectedChange.subscribe((v) => {
    emitted.push(v);
    fixture.componentRef.setInput('selected', v); // the form feeds the selection back
  });
  fixture.detectChanges();
  return { fixture, emitted, el: fixture.nativeElement as HTMLElement };
}

const q = (el: HTMLElement, sel: string) => el.querySelector<HTMLElement>(sel);
const options = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('[role="option"]')];
const option = (el: HTMLElement, text: string) => options(el).find((o) => o.textContent?.includes(text))!;
function openPanel(fixture: ComponentFixture<InstrumentPickerComponent>, el: HTMLElement) {
  q(el, '[data-testid="instrument-trigger"]')!.click();
  fixture.detectChanges();
}
function key(fixture: ComponentFixture<InstrumentPickerComponent>, target: HTMLElement, k: string) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  fixture.detectChanges();
}

describe('InstrumentPickerComponent (T-039: dropdown multiselect)', () => {
  it('starts closed: a placeholder, the count and no list', () => {
    const { el } = setup([]);
    expect(q(el, '[data-testid="instrument-trigger"]')?.textContent).toContain('Choose instruments…');
    expect(q(el, '[data-testid="instrument-trigger"]')?.textContent).toContain('0 / 4');
    expect(q(el, '[data-testid="instrument-trigger"]')?.getAttribute('aria-expanded')).toBe('false');
    expect(q(el, '[data-testid="instrument-panel"]')).toBeNull();
  });

  it('opens on click and lists covered instruments only, grouped by session currency', () => {
    const { fixture, el } = setup([]);
    openPanel(fixture, el);
    expect(q(el, '[data-testid="instrument-trigger"]')?.getAttribute('aria-expanded')).toBe('true');
    expect([...el.querySelectorAll('.group-head')].map((g) => g.textContent?.trim())).toEqual(['CHF', 'USD']);
    expect(options(el).map((o) => o.querySelector('.name')?.textContent)).toEqual(['EUR/CHF', 'BTC/USDT Perp', 'ETH/USDT Perp']);
    expect(el.textContent).not.toContain('US Tech 100'); // coverage null
  });

  it('a click toggles an option and emits the new selection, across groups too (the form refuses the mix)', () => {
    const { fixture, el, emitted } = setup(['binance:BTCUSDT']);
    openPanel(fixture, el);
    option(el, 'EUR/CHF').click();
    fixture.detectChanges();
    expect(emitted.at(-1)).toEqual(['binance:BTCUSDT', 'capitalcom:EURCHF']);
    expect(option(el, 'EUR/CHF').getAttribute('aria-selected')).toBe('true');
    option(el, 'BTC/USDT').click();
    fixture.detectChanges();
    expect(emitted.at(-1)).toEqual(['capitalcom:EURCHF']);
  });

  it('at 4 selected, the others are disabled and a click on one emits nothing', () => {
    const { fixture, el, emitted } = setup(['binance:BTCUSDT', 'binance:ETHUSDT', 'binance:X', 'binance:Y'] as InstrumentId[]);
    openPanel(fixture, el);
    expect(option(el, 'EUR/CHF').getAttribute('aria-disabled')).toBe('true');
    option(el, 'EUR/CHF').click();
    expect(emitted).toEqual([]);
    expect(option(el, 'ETH/USDT').getAttribute('aria-disabled')).toBe('false'); // selected ones stay removable
  });

  it('the search box filters the list', () => {
    const { fixture, el } = setup([]);
    openPanel(fixture, el);
    const search = q(el, 'input[type="search"]') as HTMLInputElement;
    search.value = 'eth';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(options(el).map((o) => o.querySelector('.name')?.textContent)).toEqual(['ETH/USDT Perp']);
    search.value = 'zzz';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.textContent).toContain('No instrument matches');
  });

  it('keyboard: ArrowDown opens, the arrows move, Enter toggles, Escape closes and returns focus', async () => {
    const { fixture, el, emitted } = setup([]);
    const trigger = q(el, '[data-testid="instrument-trigger"]')!;
    key(fixture, trigger, 'ArrowDown');
    await fixture.whenStable();
    const search = q(el, 'input[type="search"]')!;
    expect(search).not.toBeNull();
    expect(document.activeElement).toBe(search); // focus lands in the search box once it has rendered
    key(fixture, search, 'ArrowDown'); // EUR/CHF
    key(fixture, search, 'ArrowDown'); // BTC/USDT Perp
    expect(search.getAttribute('aria-activedescendant')).toBe(option(el, 'BTC/USDT').id);
    key(fixture, search, 'Enter');
    expect(emitted.at(-1)).toEqual(['binance:BTCUSDT']);
    key(fixture, search, 'ArrowUp'); // EUR/CHF
    key(fixture, search, 'Enter');
    expect(emitted.at(-1)).toEqual(['binance:BTCUSDT', 'capitalcom:EURCHF']);
    trigger.focus = vi.fn();
    key(fixture, search, 'Escape');
    expect(q(el, '[data-testid="instrument-panel"]')).toBeNull();
    expect(trigger.focus).toHaveBeenCalled();
  });

  it('shows the chosen instruments as chips; a chip ✕ removes one', () => {
    const { fixture, el, emitted } = setup(['binance:BTCUSDT', 'binance:ETHUSDT']);
    const chips = [...el.querySelectorAll<HTMLElement>('[data-testid="instrument-chip"]')];
    expect(chips.map((c) => c.textContent?.replace('✕', '').trim())).toEqual(['BTC/USDT Perp', 'ETH/USDT Perp']);
    chips[0].querySelector<HTMLElement>('.remove')!.click();
    fixture.detectChanges();
    expect(emitted.at(-1)).toEqual(['binance:ETHUSDT']);
    expect(q(el, '[data-testid="instrument-panel"]')).toBeNull(); // removing a chip does not open the list
  });

  it('a click outside closes the list', () => {
    const { fixture, el } = setup([]);
    openPanel(fixture, el);
    document.body.click();
    fixture.detectChanges();
    expect(q(el, '[data-testid="instrument-panel"]')).toBeNull();
  });
});

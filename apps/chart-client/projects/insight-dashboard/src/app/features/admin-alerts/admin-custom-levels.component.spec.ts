import { TestBed } from '@angular/core/testing';
import type { WebCustomLevelCreate, WebCustomLevelPatch, WebCustomLevelsResponse } from '@trade-automation/contracts';
import { ApiError } from '@backtest-core/api/api-error';
import { describe, expect, it } from 'vitest';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import { AdminCustomLevelsComponent } from './admin-custom-levels.component';

/** IB-128 (alerts design §4 P9) — the custom levels block against a stub API: what it shows and sends. */
const LEVEL = {
  id: 7, symbol: 'BTCUSDT', base: 'BTC', price: 72_000, note: 'range high', createdBy: 1, createdAt: Date.UTC(2026, 10, 6, 9, 30) / 1000,
  events: { breakout_up: true, breakout_down: true, sweep_above: false, sweep_below: true },
};

async function setup(levels: WebCustomLevelsResponse['levels'] = [LEVEL], fail: Error | null = null) {
  const calls: Array<[string, unknown]> = [];
  let current: WebCustomLevelsResponse = { levels };
  const answer = async (what: string, body: unknown) => {
    calls.push([what, body]);
    if (fail) throw fail;
    return current;
  };
  TestBed.configureTestingModule({
    imports: [AdminCustomLevelsComponent],
    providers: [{
      provide: InsightApiClient,
      useValue: {
        customLevels: async () => current,
        addCustomLevel: (b: WebCustomLevelCreate) => answer('add', b),
        patchCustomLevel: (id: number, p: WebCustomLevelPatch) => answer('patch', [id, p]),
        deleteCustomLevel: async (id: number) => { current = { levels: [] }; return answer('delete', id); },
      },
    }],
  });
  TestBed.inject(I18nService).setLang('en');
  const fixture = TestBed.createComponent(AdminCustomLevelsComponent);
  fixture.componentRef.setInput('symbols', ['BTCUSDT', 'TRXUSDT']);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance, calls, el: fixture.nativeElement as HTMLElement };
}

describe('AdminCustomLevelsComponent (IB-128)', () => {
  it('lists each level with its note, price and four event switches', async () => {
    const { el } = await setup();
    expect(el.querySelector('h3')?.textContent).toContain('Custom levels');
    const row = el.querySelector('tr[data-level="7"]') as HTMLElement;
    expect(row.textContent).toContain('#7');
    expect(row.textContent).toContain('range high');
    expect(row.textContent).toContain('72000');
    expect([...row.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map((i) => i.checked)).toEqual([true, true, false, true]);
  });

  it('adds for the first coin by default; a comma price cannot be sent; the form clears after', async () => {
    const { cmp, calls } = await setup();
    cmp.edit('price', '72,000');
    expect(cmp.body()).toBeNull();
    expect(cmp.priceBad()).toBe(true);
    cmp.edit('price', '65000');
    cmp.edit('note', 'support');
    await cmp.add();
    expect(calls).toEqual([['add', { symbol: 'BTCUSDT', price: 65_000, note: 'support' }]]);
    expect(cmp.form()).toEqual({ symbol: '', price: '', note: '' });
    cmp.edit('symbol', 'TRXUSDT');
    cmp.edit('price', '0.31');
    expect(cmp.body()).toEqual({ symbol: 'TRXUSDT', price: 0.31 });
  });

  it('an event switch sends just that event', async () => {
    const { cmp, calls } = await setup();
    await cmp.setEvent(7, 'sweep_above', true);
    expect(calls).toEqual([['patch', [7, { events: { sweep_above: true } }]]]);
  });

  it('delete asks a second click, then the list comes back without it', async () => {
    const { cmp, calls, fixture, el } = await setup();
    await cmp.remove(7);
    fixture.detectChanges();
    expect(calls).toEqual([]);
    expect(el.querySelector('[data-testid="custom-level-delete-7"]')?.textContent).toContain('Delete level #7 BTCUSDT 72000?');
    await cmp.remove(7);
    fixture.detectChanges();
    expect(calls).toEqual([['delete', 7]]);
    expect(el.textContent).toContain('No custom levels yet.');
  });

  it('a coin at its cap is said in words', async () => {
    const { cmp, fixture, el } = await setup([LEVEL], new ApiError(409, 'TOO_MANY_LEVELS', 'x'));
    cmp.edit('price', '1');
    await cmp.add();
    fixture.detectChanges();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('most levels allowed');
    expect(cmp.form().price).toBe('1');
  });
});

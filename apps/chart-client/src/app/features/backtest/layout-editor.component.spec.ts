import { vi } from 'vitest';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { BacktestInstrument, Order, Session, SessionLayout } from '@trade-automation/contracts';
import { ApiError } from '../../core/api/api-error';
import { BacktestClient } from '../../core/api/backtest.client';
import { ReplaySessionStore } from '../../core/replay/replay-session.store';
import { LayoutEditorComponent } from './layout-editor.component';

const T0 = Date.UTC(2021, 5, 1);
const DAY = 86_400_000;
const LAYOUT: SessionLayout = {
  id: 'l',
  name: 'L',
  grid: { columns: 2, rows: 1 },
  panels: [
    { id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false },
    { id: 'eth', kind: 'candles', instrument: 'binance:ETHUSDT', signals: false },
  ],
};
const CATALOGUE: BacktestInstrument[] = [
  { id: 'binance:BTCUSDT', displayName: 'BTC/USDT Perp', assetClass: 'crypto-perp', sessionCurrency: 'USD', pricePrecision: 2, coverage: { from: T0, to: T0 + 60 * DAY }, contract: null },
  { id: 'binance:SOLUSDT', displayName: 'SOL/USDT Perp', assetClass: 'crypto-perp', sessionCurrency: 'USD', pricePrecision: 2, coverage: { from: T0, to: T0 + 60 * DAY }, contract: null },
  { id: 'capitalcom:EURCHF', displayName: 'EUR/CHF', assetClass: 'forex-cfd', sessionCurrency: 'CHF', pricePrecision: 5, coverage: { from: T0, to: T0 + 60 * DAY }, contract: null },
];

function session(over: Partial<Session> = {}): Session {
  return {
    id: 's1', name: 'S', status: 'active', sessionCurrency: 'USD', timeframe: '5m', periodFromMs: T0 + 10 * DAY, periodToMs: T0 + 20 * DAY,
    cursorMs: T0 + 12 * DAY, initialBalance: 1000, balance: 1000, defaultRiskPct: 1, costs: { enabled: false, commissionPct: 0, spread: 0 },
    skipWeekends: true, layout: LAYOUT, createdAt: 1, updatedAt: 1, completedAt: null, ...over,
  };
}

async function setup(opts: { orders?: Partial<Order>[]; status?: Session['status']; patch?: ReturnType<typeof vi.fn> } = {}) {
  const calls: string[] = [];
  const store = {
    session: signal<Session | null>(session({ status: opts.status ?? 'active' })),
    engine: signal({
      addPanel: vi.fn(async (p: { id: string }) => void calls.push(`addPanel ${p.id}`)),
      removePanel: vi.fn(async (id: string) => void calls.push(`removePanel ${id}`)),
    }),
    portfolio: { orders: signal(opts.orders ?? []) },
  };
  const patchSession = opts.patch ?? vi.fn(async (_id: string, body: { layout: SessionLayout }) => {
    calls.push('patch');
    return session({ layout: body.layout });
  });
  TestBed.configureTestingModule({
    imports: [LayoutEditorComponent],
    providers: [
      { provide: ReplaySessionStore, useValue: store },
      { provide: BacktestClient, useValue: { getInstruments: vi.fn().mockResolvedValue(CATALOGUE), patchSession } },
    ],
  });
  const fixture = TestBed.createComponent(LayoutEditorComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  el.querySelector<HTMLButtonElement>('button.toggle')!.click();
  await settle(fixture);
  // record when the session's layout changes, relative to the engine calls
  const set = store.session.update.bind(store.session);
  store.session.update = (fn) => {
    calls.push('session.layout');
    set(fn);
  };
  return { fixture, el, store, patchSession, calls };
}

async function settle(fixture: ComponentFixture<LayoutEditorComponent>): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve));
  await fixture.whenStable();
  fixture.detectChanges();
}

const rows = (el: HTMLElement) => [...el.querySelectorAll('[data-testid="layout-panel"] .name')].map((n) => n.textContent?.trim());
const button = (el: HTMLElement, row: number, label: string) =>
  el.querySelectorAll('[data-testid="layout-panel"]')[row].querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

describe('LayoutEditorComponent (T-029)', () => {
  it('offers only instruments in the session currency that are not on the layout yet', async () => {
    const { el } = await setup();
    expect(rows(el)).toEqual(['binance:BTCUSDT', 'binance:ETHUSDT']);
    const options = [...el.querySelectorAll('select[name="addInstrument"] option')].map((o) => o.textContent?.trim());
    expect(options).toEqual(['Add an instrument…', 'SOL/USDT Perp']);
  });

  it('add: PATCH with the new layout, the engine gains the tape before the grid sees the layout', async () => {
    const { fixture, el, store, patchSession, calls } = await setup();
    const select = el.querySelector<HTMLSelectElement>('select[name="addInstrument"]')!;
    select.value = 'binance:SOLUSDT';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('.panel > .add button')!.click();
    await settle(fixture);
    const sent = patchSession.mock.calls[0][1].layout as SessionLayout;
    expect(sent.panels.map((p) => p.id)).toEqual(['btc', 'eth', 'binance-solusdt']);
    expect(calls).toEqual(['patch', 'addPanel binance-solusdt', 'session.layout']);
    expect(store.session()!.layout.panels).toHaveLength(3);
  });

  it('remove: refused with a message (no request) when the panel has a pending or open order', async () => {
    const { fixture, el, patchSession } = await setup({ orders: [{ panelId: 'eth', instrument: 'binance:ETHUSDT', status: 'open' }] });
    expect(el.querySelectorAll('[data-testid="layout-panel"]')[1].textContent).toContain('orders');
    button(el, 1, 'Remove panel').click();
    await settle(fixture);
    expect(el.querySelector('[data-testid="layout-error"]')?.textContent).toMatch(/Panel 'eth' has pending or open orders/);
    expect(patchSession).not.toHaveBeenCalled();
  });

  it('remove: the grid drops the panel before the engine drops its tape', async () => {
    const { fixture, el, calls } = await setup({ orders: [{ panelId: 'eth', instrument: 'binance:ETHUSDT', status: 'closed' }] });
    button(el, 1, 'Remove panel').click();
    await settle(fixture);
    expect(calls).toEqual(['patch', 'session.layout', 'removePanel eth']);
    expect(rows(el)).toEqual(['binance:BTCUSDT']);
    expect(button(el, 0, 'Remove panel').disabled).toBe(true); // the last panel stays
  });

  it('reorder: one PATCH, no tape changes', async () => {
    const { fixture, el, patchSession, calls } = await setup();
    button(el, 1, 'Move up').click();
    await settle(fixture);
    expect((patchSession.mock.calls[0][1].layout as SessionLayout).panels.map((p) => p.id)).toEqual(['eth', 'btc']);
    expect(calls).toEqual(['patch', 'session.layout']);
    expect(button(el, 0, 'Move up').disabled).toBe(true);
  });

  it('a server refusal is shown and the layout is left as it was', async () => {
    const patch = vi.fn().mockRejectedValue(new ApiError(409, null, 'x'));
    const { fixture, el, store } = await setup({ patch });
    button(el, 1, 'Remove panel').click();
    await settle(fixture);
    expect(el.querySelector('[data-testid="layout-error"]')?.textContent).toMatch(/pending or open orders/);
    expect(store.session()!.layout).toBe(LAYOUT);
  });

  it('a complete session cannot be edited', async () => {
    const { el } = await setup({ status: 'complete' });
    expect(el.textContent).toContain('The session is complete');
    expect(el.querySelectorAll('[data-testid="layout-panel"]')).toHaveLength(0);
  });
});

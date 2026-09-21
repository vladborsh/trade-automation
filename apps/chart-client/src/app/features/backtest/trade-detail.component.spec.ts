import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Order, OrderDetail, Session } from '@trade-automation/contracts';
import { BacktestClient } from '../../core/api/backtest.client';
import { TradeDetailComponent } from './trade-detail.component';

const T = Date.UTC(2026, 8, 16, 10, 4);
const ORDER = {
  id: 'o1', seq: 1, instrument: 'binance:BTCUSDT', side: 'long', type: 'market', status: 'closed', placedAtMs: T + 60_000,
  limitPrice: null, slInitial: 95, slCurrent: 95, tpInitial: 110, tpCurrent: 110, entryPrice: 100, entryTimeMs: T, exitPrice: 110,
  exitTimeMs: T + 600_000, closeReason: 'take-profit', qty: 1, riskPct: 1, riskAmountCcy: 100, commissionCcy: 0.1, spreadCostCcy: 0.05,
  pnlCcy: 9.85, pnlR: 1.97, maePrice: 1, maeR: 0.2, fillResolution: '1m', slTpSameBar: false,
} as unknown as Order;

async function render(detail: Partial<OrderDetail>) {
  const client = {
    getSession: vi.fn(async () => ({ session: { id: 's1', sessionCurrency: 'USD' } as Session })),
    getOrder: vi.fn(async (): Promise<OrderDetail> => ({ order: ORDER, modifications: [], screenshots: {}, ...detail })),
    getInstruments: vi.fn(async () => [{ id: 'binance:BTCUSDT', pricePrecision: 1 }]),
    fetchScreenshot: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
  };
  TestBed.configureTestingModule({ imports: [TradeDetailComponent], providers: [provideRouter([]), { provide: BacktestClient, useValue: client }] });
  const fixture = TestBed.createComponent(TradeDetailComponent);
  fixture.componentRef.setInput('id', 's1');
  fixture.componentRef.setInput('orderId', 'o1');
  fixture.detectChanges();
  await fixture.whenStable();
  await new Promise((r) => setTimeout(r, 0));
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement, client, fixture };
}

describe('TradeDetailComponent (§9.3)', () => {
  it('shows the order row from the server, with raw values', async () => {
    const { el } = await render({});
    expect(el.querySelector('h1')?.textContent).toContain('Trade #1');
    expect(el.querySelector('[data-field="entryPrice"] dd')?.textContent).toBe('100.0');
    expect(el.querySelector('[data-field="pnlR"]')?.getAttribute('data-value')).toBe('1.97');
    expect(el.querySelector('[data-testid="no-modifications"]')).not.toBeNull();
  });

  it('"Show on chart" opens the workspace view-only at the revealed entry candle', async () => {
    const { el } = await render({});
    expect(el.querySelector('[data-testid="show-on-chart"]')?.getAttribute('href')).toBe(`/sessions/s1?viewAt=${T + 60_000}&order=o1`);
  });

  it('lists the modifications', async () => {
    const { el } = await render({ modifications: [{ id: 1, orderId: 'o1', cursorMs: T + 120_000, field: 'sl', oldValue: 95, newValue: 98, createdAt: 0 }] });
    expect(el.querySelector('.mods li')?.textContent).toBe('2026-09-16 10:06 UTC — Stop 95.0 → 98.0');
  });

  it('fetches the screenshots it has, placeholders for the rest', async () => {
    const { el, client } = await render({ screenshots: { entry: '/api/backtest/sessions/s1/orders/o1/screenshots/entry' } });
    expect(client.fetchScreenshot).toHaveBeenCalledWith('/api/backtest/sessions/s1/orders/o1/screenshots/entry');
    expect(el.querySelector('[data-shot="entry"] img')?.getAttribute('src')).toMatch(/^blob:/);
    expect(el.querySelector('[data-shot="exit"] [data-testid="shot-placeholder"]')?.textContent).toBe('No exit screenshot');
  });
});

import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Order, Session, SessionStats } from '@trade-automation/contracts';
import { BacktestClient } from '../../core/api/backtest.client';
import { EQUITY_CHART_FACTORY } from './equity-chart.component';
import { StatsFullComponent } from './stats-full.component';

const T0 = Date.UTC(2026, 8, 16, 10);
const SESSION = { id: 's1', name: 'BTC practice', sessionCurrency: 'USD' } as Session;

function stats(extra: Partial<SessionStats>): SessionStats {
  return {
    trades: 0, wins: 0, losses: 0, breakeven: 0, winRate: 0, pnl: 0, pnlR: 0, grossProfit: 0, grossProfitR: 0, grossLoss: 0, grossLossR: 0,
    profitFactor: null, equityCurve: [{ time: T0, balance: 10_000, balanceR: 0 }], maxDrawdownCcy: 0, maxDrawdownR: 0, maxDrawdownPct: 0,
    avgWin: null, avgWinR: null, avgLoss: null, avgLossR: null, expectancyR: 0, maeAvg: null, maeWorst: null, pessimisticTrades: 0,
    endOfSessionCloses: 0, byInstrument: {}, bySide: {}, ...extra,
  };
}

const fakeChart = () => {
  const s = { setData: vi.fn(), priceScale: () => ({ applyOptions: vi.fn() }) };
  return { addSeries: vi.fn(() => s), priceScale: () => ({ applyOptions: vi.fn() }), timeScale: () => ({ fitContent: vi.fn() }), remove: vi.fn() };
};

/** A full order row (the journal renders every field); closed by default. */
let seq = 0;
const order = (extra: Partial<Order> = {}): Order =>
  ({
    id: `o${++seq}`, seq, instrument: 'binance:BTCUSDT', side: 'long', type: 'market', status: 'closed', placedAtMs: T0, entryPrice: 100,
    entryTimeMs: T0, exitPrice: 110, exitTimeMs: T0 + 60_000, closeReason: 'take-profit', qty: 0.1, commissionCcy: 0, spreadCostCcy: 0,
    pnlCcy: 1, pnlR: 0.1, maeR: 0.2, fillResolution: '1m', slTpSameBar: false, slInitial: 95, slCurrent: 95, ...extra,
  }) as Order;

/** `orders` is every order of the session (`GET …/orders`, T-042); partials become full closed rows. */
async function render(computed: SessionStats, orders: Partial<Order>[] = [], drift = false) {
  const errors: unknown[] = [];
  const client = {
    getSession: vi.fn(async () => ({ session: SESSION })),
    getStats: vi.fn(async () => ({ computed, stored: {}, drift })),
    listOrders: vi.fn(async () => orders.map((o) => order(o))),
    getInstruments: vi.fn(async () => [{ id: 'binance:BTCUSDT', pricePrecision: 1, contract: { unit: 'BTC' } }]),
  };
  TestBed.configureTestingModule({
    imports: [StatsFullComponent],
    providers: [provideRouter([]), { provide: BacktestClient, useValue: client }, { provide: EQUITY_CHART_FACTORY, useValue: fakeChart }],
  });
  const fixture = TestBed.createComponent(StatsFullComponent);
  fixture.componentRef.setInput('id', 's1');
  try {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
  } catch (err) {
    errors.push(err);
  }
  return { el: fixture.nativeElement as HTMLElement, client, errors };
}

const value = (el: HTMLElement, key: string) => el.querySelector(`[data-stat="${key}"]`)?.getAttribute('data-value');

describe('StatsFullComponent', () => {
  it('an empty session renders, says there are no trades yet, and shows the seed point only', async () => {
    const { el, errors, client } = await render(stats({}));
    expect(errors).toEqual([]);
    expect(client.listOrders).toHaveBeenCalledWith('s1'); // every order: the journal (T-042)
    expect(el.querySelector('[data-testid="stats-empty"]')).not.toBeNull();
    expect(el.querySelectorAll('[data-testid="equity-points"] li')).toHaveLength(1);
    expect(el.querySelector('[data-stat="winRate"] .value')?.textContent).toBe('—');
    expect([...el.querySelectorAll('[data-testid="r-histogram"] li')].every((li) => li.getAttribute('data-count') === '0')).toBe(true);
    expect(el.textContent).toContain('Нет закрытых сделок.');
  });

  it('a one-trade session: its figures, its curve step and its bin', async () => {
    const one = stats({
      trades: 1, wins: 1, winRate: 1, pnl: 24.46, pnlR: 0.24, profitFactor: null, avgWin: 24.46, avgWinR: 0.24, expectancyR: 0.24,
      maeAvg: 0.89, maeWorst: 0.89,
      equityCurve: [{ time: T0, balance: 10_000, balanceR: 0 }, { time: T0 + 3_600_000, balance: 10_024.46, balanceR: 0.24 }],
      byInstrument: { 'binance:BTCUSDT': { trades: 1, winRate: 1, pnl: 24.46, pnlR: 0.24 } },
      bySide: { long: { trades: 1, winRate: 1, pnl: 24.46, pnlR: 0.24 } },
    });
    const { el, errors } = await render(one, [{ pnlR: 0.24 }]);
    expect(errors).toEqual([]);
    expect(value(el, 'pnl')).toBe('24.46');
    expect(el.querySelector('[data-stat="profitFactor"] .value')?.textContent).toBe('n/a');
    expect(el.querySelectorAll('[data-testid="equity-points"] li')).toHaveLength(2);
    expect(el.querySelector('[data-bin="0R … +0.5R"]')?.getAttribute('data-count')).toBe('1');
    expect(value(el, 'bySide.long.pnlR')).toBe('0.24');
  });

  it('a multi-instrument session: one breakdown row per instrument and side, the pessimistic trades called out, drift shown', async () => {
    const multi = stats({
      trades: 3, wins: 1, losses: 2, winRate: 1 / 3, pnl: -80, pnlR: -0.8, profitFactor: 0.5, pessimisticTrades: 1, endOfSessionCloses: 1,
      byInstrument: {
        'binance:BTCUSDT': { trades: 2, winRate: 0.5, pnl: -20, pnlR: -0.2 },
        'binance:ETHUSDT': { trades: 1, winRate: 0, pnl: -60, pnlR: -0.6 },
      },
      bySide: { long: { trades: 2, winRate: 0.5, pnl: -20, pnlR: -0.2 }, short: { trades: 1, winRate: 0, pnl: -60, pnlR: -0.6 } },
    });
    const { el, errors } = await render(multi, [{ pnlR: 1 }, { pnlR: -1 }, { pnlR: -0.8 }], true);
    expect(errors).toEqual([]);
    expect([...el.querySelectorAll('[data-breakdown]')].map((r) => r.getAttribute('data-breakdown'))).toEqual([
      'byInstrument.binance:BTCUSDT', 'byInstrument.binance:ETHUSDT', 'bySide.long', 'bySide.short',
    ]);
    expect(value(el, 'byInstrument.binance:ETHUSDT.pnl')).toBe('-60');
    expect(el.querySelector('[data-testid="pessimistic-callout"]')?.textContent).toContain('1 из 3 сделок посчитаны по барам');
    expect(el.querySelector('[data-testid="stats-drift"]')).not.toBeNull();
  });

  it('T-042: the whole journal below the figures — every order, always open, rows linking to the trade detail; the R bins count closed trades only', async () => {
    const orders = [{ pnlR: 1.5 }, { status: 'open', exitPrice: null, exitTimeMs: null, closeReason: null, pnlCcy: null, pnlR: null }, { status: 'cancelled', pnlR: null }] as Partial<Order>[];
    const { el, errors } = await render(stats({ trades: 1 }), orders);
    expect(errors).toEqual([]);
    const rows = [...el.querySelectorAll('app-journal [data-testid="journal-row"]')];
    expect(rows.map((r) => r.querySelector('[data-field="status"]')?.getAttribute('data-value'))).toEqual(['closed', 'open', 'cancelled']);
    const first = rows[0].getAttribute('data-order-id');
    expect(rows[0].querySelector('[data-field="seq"] a')?.getAttribute('href')).toBe(`/sessions/s1/trades/${first}`);
    expect(el.querySelector('[data-testid="journal-toggle"]')).toBeNull(); // not collapsible here
    expect(rows[0].querySelector('[data-field="entryPrice"]')?.textContent?.trim()).toBe('100.0'); // the instrument's precision
    const counts = [...el.querySelectorAll('[data-testid="r-histogram"] li')].map((li) => Number(li.getAttribute('data-count')));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1); // the open and the cancelled order are not in the distribution
  });
});

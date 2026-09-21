import { vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { SessionSummary } from '@trade-automation/contracts';
import { ApiError } from '../../core/api/api-error';
import { BacktestClient } from '../../core/api/backtest.client';
import { AuthService } from '../../core/auth/auth.service';
import { SessionListComponent } from './session-list.component';

function summary(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: '00000000-0000-4000-8000-0000000000a1',
    name: 'BTC practice',
    status: 'active',
    sessionCurrency: 'USD',
    timeframe: '15m',
    periodFromMs: Date.UTC(2021, 5, 1),
    periodToMs: Date.UTC(2021, 6, 1),
    cursorMs: Date.UTC(2021, 5, 1),
    initialBalance: 10_000,
    balance: 10_150.25,
    defaultRiskPct: 1,
    costs: { enabled: true, commissionPct: 0.04, spread: 0.5 },
    skipWeekends: true,
    notionalWarnMultiple: 5,
    layout: {
      id: 'l',
      name: 'L',
      grid: { columns: 2, rows: 1 },
      panels: [
        { id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false },
        { id: 'eth', kind: 'candles', instrument: 'binance:ETHUSDT', signals: false },
      ],
    },
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
    tradesCount: 3,
    winsCount: 2,
    lossesCount: 1,
    pnlCcy: 150.25,
    pnlR: 1.5,
    profitFactor: 2,
    maxDrawdownCcy: 10,
    maxDrawdownR: 0.1,
    avgWinCcy: 100,
    avgWinR: 1,
    avgLossCcy: -50,
    avgLossR: -0.5,
    statsComputedAt: 1,
    ...over,
  };
}

async function setup(client: Partial<Record<keyof BacktestClient, ReturnType<typeof vi.fn>>>) {
  TestBed.configureTestingModule({
    imports: [SessionListComponent],
    providers: [
      provideRouter([]),
      { provide: BacktestClient, useValue: client },
      { provide: AuthService, useValue: { user: signal(null).asReadonly() } },
    ],
  });
  const fixture = TestBed.createComponent(SessionListComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('SessionListComponent', () => {
  it('lists each session: name, instruments, period, tf, status, balance, PnL in currency and R, trades', async () => {
    const { el } = await setup({ listSessions: vi.fn().mockResolvedValue([summary()]) });
    const cells = [...el.querySelectorAll('[data-testid="session-row"] td')].map(text);
    expect(cells.slice(0, 9)).toEqual([
      'BTC practice',
      'BTCUSDT, ETHUSDT',
      '2021-06-01 00:00 → 2021-07-01 00:00 UTC',
      '15m',
      'active',
      '10,150.25 USD',
      '+150.25 USD',
      '+1.50 R',
      '3',
    ]);
    expect(el.querySelector('[data-testid="session-row"] a')?.getAttribute('href')).toBe('/sessions/00000000-0000-4000-8000-0000000000a1');
    expect(el.querySelector('a.primary')?.getAttribute('href')).toBe('/sessions/new');
  });

  it('delete asks first, saying orders and screenshots go too; cancel keeps the session', async () => {
    const deleteSession = vi.fn().mockResolvedValue(undefined);
    const { fixture, el } = await setup({ listSessions: vi.fn().mockResolvedValue([summary()]), deleteSession });
    el.querySelector<HTMLButtonElement>('button.danger')!.click();
    fixture.detectChanges();
    const confirm = text(el.querySelector('[data-testid="delete-confirm"]'));
    expect(confirm).toContain('removes the session together with all its orders and screenshots');
    expect(confirm).toContain('cannot be undone');
    expect(deleteSession).not.toHaveBeenCalled();

    [...el.querySelectorAll<HTMLButtonElement>('[data-testid="delete-confirm"] button')].find((b) => text(b) === 'Cancel')!.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="delete-confirm"]')).toBeNull();
    expect(el.querySelectorAll('[data-testid="session-row"]')).toHaveLength(1);
  });

  it('confirming deletes on the server and removes the row', async () => {
    const deleteSession = vi.fn().mockResolvedValue(undefined);
    const { fixture, el } = await setup({ listSessions: vi.fn().mockResolvedValue([summary(), summary({ id: 'other', name: 'Other' })]), deleteSession });
    el.querySelector<HTMLButtonElement>('button.danger')!.click();
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('button.danger-fill')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(deleteSession).toHaveBeenCalledWith('00000000-0000-4000-8000-0000000000a1');
    expect([...el.querySelectorAll('[data-testid="session-row"] .name')].map(text)).toEqual(['Other']);
  });

  it('a failed delete keeps the row and says why', async () => {
    const { fixture, el } = await setup({
      listSessions: vi.fn().mockResolvedValue([summary()]),
      deleteSession: vi.fn().mockRejectedValue(new ApiError(500, null, 'x')),
    });
    el.querySelector<HTMLButtonElement>('button.danger')!.click();
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('button.danger-fill')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text(el.querySelector('[data-testid="delete-confirm"] [role="alert"]'))).toMatch(/Could not delete/);
    expect(el.querySelectorAll('[data-testid="session-row"]')).toHaveLength(1);
  });

  it('shows an empty state and a load error', async () => {
    const empty = await setup({ listSessions: vi.fn().mockResolvedValue([]) });
    expect(text(empty.el.querySelector('main'))).toContain('No sessions yet');
    TestBed.resetTestingModule();
    const failed = await setup({ listSessions: vi.fn().mockRejectedValue(new ApiError(503, null, 'x')) });
    expect(text(failed.el.querySelector('[role="alert"]'))).toMatch(/no database configured/);
  });

  it('colours a loss down', async () => {
    const { el } = await setup({ listSessions: vi.fn().mockResolvedValue([summary({ pnlCcy: -20, pnlR: -0.2 })]) });
    const cells = el.querySelectorAll('[data-testid="session-row"] td.num');
    expect(cells[1].classList.contains('down')).toBe(true);
    expect(text(cells[1])).toBe('−20.00 USD');
  });
});

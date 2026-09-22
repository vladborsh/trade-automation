import { vi } from 'vitest';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { Layout } from '@trade-automation/contracts';
import { ApiError } from '../../core/api/api-error';
import { BacktestClient } from '../../core/api/backtest.client';
import { RestClient } from '../../core/api/rest.client';
import { AuthService } from '../../core/auth/auth.service';
import { SessionCreateComponent } from './session-create.component';
import { CATALOGUE_LIST, DAY, T0 } from './sessions-test-fixtures';

const LAYOUTS: Layout[] = [
  {
    id: 'crypto',
    name: 'Crypto trading',
    grid: { columns: 4, rows: 1 },
    panels: [
      { id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: true },
      { id: 'btc-oi', kind: 'metric', instrument: 'binance:BTCUSDT', metric: 'openInterest', signals: false },
      { id: 'ndx', kind: 'candles', instrument: 'capitalcom:US100', signals: false },
    ],
  },
];

/** Lets the component's own awaited promises (ngOnInit's Promise.all, submit) finish, then renders. */
async function settle(fixture: ComponentFixture<SessionCreateComponent>): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve));
  await fixture.whenStable();
  fixture.detectChanges();
}

async function setup(createSession = vi.fn().mockResolvedValue({ id: 'created-session-id' })) {
  TestBed.configureTestingModule({
    imports: [SessionCreateComponent],
    providers: [
      provideRouter([]),
      { provide: BacktestClient, useValue: { getInstruments: vi.fn().mockResolvedValue(CATALOGUE_LIST), createSession } },
      { provide: RestClient, useValue: { getLayouts: vi.fn().mockResolvedValue(LAYOUTS) } },
      { provide: AuthService, useValue: { user: signal(null).asReadonly() } },
    ],
  });
  const fixture = TestBed.createComponent(SessionCreateComponent);
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  fixture.detectChanges();
  await settle(fixture);
  return { fixture, createSession, navigate, el: fixture.nativeElement as HTMLElement };
}

/** Picks an instrument in the dropdown multiselect (T-039), opening it first if needed. */
function check(fixture: ComponentFixture<SessionCreateComponent>, label: string): void {
  const el = fixture.nativeElement as HTMLElement;
  if (!el.querySelector('[data-testid="instrument-panel"]')) {
    el.querySelector<HTMLElement>('[data-testid="instrument-trigger"]')!.click();
    fixture.detectChanges();
  }
  const option = [...el.querySelectorAll<HTMLElement>('app-instrument-picker [role="option"]')].find((o) => o.textContent?.includes(label))!;
  option.click();
  fixture.detectChanges();
}

function type(fixture: ComponentFixture<SessionCreateComponent>, name: string, value: string): void {
  const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

async function submit(fixture: ComponentFixture<SessionCreateComponent>): Promise<void> {
  (fixture.nativeElement as HTMLElement).querySelector('form')!.dispatchEvent(new Event('submit'));
  await settle(fixture);
}

const submitButton = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('button[type="submit"]')!;

describe('SessionCreateComponent', () => {
  it('creates a session with the defaults and the period moved inside the coverage, then opens its workspace (T-040)', async () => {
    const { fixture, el, createSession, navigate } = await setup();
    type(fixture, 'name', 'BTC practice');
    check(fixture, 'BTC/USDT');
    expect(el.querySelector<HTMLInputElement>('input[name="periodTo"]')!.value).toBe('2021-10-28T00:01');
    await submit(fixture);

    expect(createSession).toHaveBeenCalledTimes(1);
    const body = createSession.mock.calls[0][0];
    expect(body).toMatchObject({
      name: 'BTC practice',
      timeframe: '15m',
      periodFromMs: T0 + 270 * DAY + 60_000,
      periodToMs: T0 + 300 * DAY + 60_000,
      initialBalance: 10_000,
      defaultRiskPct: 1,
      skipWeekends: true,
      costs: { enabled: true, commissionPct: 0.04, spread: 0 },
    });
    expect(body.layout.panels).toEqual([{ id: 'binance-btcusdt', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false }]);
    expect(navigate).toHaveBeenCalledWith('/sessions/created-session-id');
  });

  it('a mixed-currency selection is flagged at once and cannot be submitted', async () => {
    const { fixture, el, createSession } = await setup();
    type(fixture, 'name', 'Mixed');
    check(fixture, 'BTC/USDT');
    check(fixture, 'EUR/CHF');
    expect(el.querySelector('[data-testid="instruments-error"]')?.textContent).toMatch(/one session currency; these mix USD and CHF/);
    expect(submitButton(el).disabled).toBe(true);
    await submit(fixture); // even a forced submit is refused
    expect(createSession).not.toHaveBeenCalled();
  });

  it('a layout preset loses its metric panel and its uncovered instrument, and says so', async () => {
    const { fixture, el, createSession } = await setup();
    const select = el.querySelector<HTMLSelectElement>('select[name="preset"]')!;
    select.value = 'crypto';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="preset-unavailable"]')?.textContent).toContain('capitalcom:US100');
    type(fixture, 'name', 'From preset');
    await submit(fixture);
    const layout = createSession.mock.calls[0][0].layout;
    expect(layout).toEqual({
      id: 'crypto',
      name: 'Crypto trading',
      grid: { columns: 4, rows: 1 },
      panels: [{ id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false }],
    });
  });

  it('shows field errors on submit and does not call the server', async () => {
    const { fixture, el, createSession } = await setup();
    check(fixture, 'BTC/USDT');
    type(fixture, 'initialBalance', '0');
    await submit(fixture);
    expect(createSession).not.toHaveBeenCalled();
    expect([...el.querySelectorAll('.field-error')].map((e) => e.textContent?.trim())).toEqual(
      expect.arrayContaining(['Give the session a name.', 'Enter a starting balance above 0.']),
    );
  });

  it('shows the server’s 422 as a message and stays on the page', async () => {
    const { fixture, el, navigate } = await setup(vi.fn().mockRejectedValue(new ApiError(422, 'PERIOD_OUTSIDE_COVERAGE', 'x')));
    type(fixture, 'name', 'x');
    check(fixture, 'BTC/USDT');
    await submit(fixture);
    expect(el.querySelector('.form-error[role="alert"]')?.textContent).toMatch(/does not overlap the stored history/);
    expect(navigate).not.toHaveBeenCalled();
  });
});

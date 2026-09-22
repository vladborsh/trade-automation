import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { SessionStats } from '@trade-automation/contracts';
import { StatsSummaryComponent } from './stats-summary.component';

const STATS = {
  trades: 2, winRate: 0.5, pnl: 10, pnlR: 0.5, profitFactor: 1.5, maxDrawdownCcy: 20, maxDrawdownR: 1, maxDrawdownPct: 0.2,
  avgWin: 30, avgWinR: 1.5, avgLoss: -20, avgLossR: -1,
} as unknown as SessionStats;

function render(stats: SessionStats | null, drift = false): HTMLElement & { fixture?: unknown } {
  TestBed.configureTestingModule({ imports: [StatsSummaryComponent], providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(StatsSummaryComponent);
  fixture.componentRef.setInput('stats', stats);
  fixture.componentRef.setInput('currency', 'USD');
  fixture.componentRef.setInput('drift', drift);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return Object.assign(el, { detect: () => fixture.detectChanges() });
}

describe('StatsSummaryComponent', () => {
  it('T-044: shows only P&L (currency and R) until Details is clicked; then every figure, each with its raw value', () => {
    const el = render(STATS) as HTMLElement & { detect: () => void };
    expect([...el.querySelectorAll('[data-stat]')].map((i) => i.getAttribute('data-stat'))).toEqual(['pnl', 'pnlR']);
    const toggle = el.querySelector<HTMLButtonElement>('[data-testid="stats-details-toggle"]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    el.detect();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelectorAll('[data-stat]')).toHaveLength(12);
    toggle.click();
    el.detect();
    expect(el.querySelectorAll('[data-stat]')).toHaveLength(2);
    const pnl = el.querySelector('[data-stat="pnl"]')!;
    expect(pnl.querySelector('dd')?.textContent).toBe('+10.00 USD');
    expect(pnl.getAttribute('data-value')).toBe('10');
    expect(el.querySelector('[data-testid="stats-drift"]')).toBeNull();
  });

  it('shows the drift notice when the stored aggregates differ', () => {
    const el = render(STATS, true);
    expect(el.querySelector('[data-testid="stats-drift"]')?.textContent).toMatch(/Stored aggregates differ/);
  });

  it('links to the full statistics screen when it knows the session', () => {
    TestBed.configureTestingModule({ imports: [StatsSummaryComponent], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(StatsSummaryComponent);
    fixture.componentRef.setInput('stats', STATS);
    fixture.componentRef.setInput('currency', 'USD');
    fixture.componentRef.setInput('sessionId', 's1');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="stats-full-link"]')?.getAttribute('href')).toBe('/sessions/s1/stats');
  });

  it('renders nothing before the stats arrive (no Details button either)', () => {
    const el = render(null);
    expect(el.querySelectorAll('[data-stat]')).toHaveLength(0);
    expect(el.querySelector('[data-testid="stats-details-toggle"]')).toBeNull();
  });
});

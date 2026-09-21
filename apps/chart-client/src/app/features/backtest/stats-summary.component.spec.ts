import { TestBed } from '@angular/core/testing';
import type { SessionStats } from '@trade-automation/contracts';
import { StatsSummaryComponent } from './stats-summary.component';

const STATS = {
  trades: 2, winRate: 0.5, pnl: 10, pnlR: 0.5, profitFactor: 1.5, maxDrawdownCcy: 20, maxDrawdownR: 1, maxDrawdownPct: 0.2,
  avgWin: 30, avgWinR: 1.5, avgLoss: -20, avgLossR: -1,
} as unknown as SessionStats;

function render(stats: SessionStats | null, drift = false) {
  TestBed.configureTestingModule({ imports: [StatsSummaryComponent] });
  const fixture = TestBed.createComponent(StatsSummaryComponent);
  fixture.componentRef.setInput('stats', stats);
  fixture.componentRef.setInput('currency', 'USD');
  fixture.componentRef.setInput('drift', drift);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('StatsSummaryComponent', () => {
  it('renders every summary figure with its raw value', () => {
    const el = render(STATS);
    expect(el.querySelectorAll('[data-stat]')).toHaveLength(12);
    const pnl = el.querySelector('[data-stat="pnl"]')!;
    expect(pnl.querySelector('dd')?.textContent).toBe('+10.00 USD');
    expect(pnl.getAttribute('data-value')).toBe('10');
    expect(el.querySelector('[data-testid="stats-drift"]')).toBeNull();
  });

  it('shows the drift notice when the stored aggregates differ', () => {
    const el = render(STATS, true);
    expect(el.querySelector('[data-testid="stats-drift"]')?.textContent).toMatch(/Stored aggregates differ/);
  });

  it('renders nothing before the stats arrive', () => {
    expect(render(null).querySelectorAll('[data-stat]')).toHaveLength(0);
  });
});

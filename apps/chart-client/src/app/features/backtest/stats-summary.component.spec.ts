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

  it('T-064: headline, Details toggle and full-stats link on one line; Details is an overlay (not in the line), closed by a second click', () => {
    const el = render(STATS) as HTMLElement & { detect: () => void };
    const line = el.querySelector('.line')!;
    expect([...line.querySelectorAll('[data-stat]')].map((i) => i.getAttribute('data-stat'))).toEqual(['pnl', 'pnlR']);
    expect(line.querySelector('[data-testid="stats-details-toggle"]')).not.toBeNull();
    expect([...el.querySelectorAll('dt')].map((d) => [d.textContent, d.classList.contains('visually-hidden')])).toEqual([
      ['P&L', false],
      ['P&L (R)', true], // the R figure's label is read out, not shown: the line stays short
    ]);
    const toggle = el.querySelector<HTMLButtonElement>('[data-testid="stats-details-toggle"]')!;
    expect(toggle.textContent).toContain('▴'); // opens upward
    toggle.click();
    el.detect();
    const overlay = el.querySelector('[data-testid="stats-details"]')!;
    expect(overlay.classList.contains('details')).toBe(true);
    expect(line.contains(overlay)).toBe(false);
    expect(overlay.querySelectorAll('[data-stat]')).toHaveLength(10);
    toggle.click();
    el.detect();
    expect(el.querySelector('[data-testid="stats-details"]')).toBeNull();
  });

  it('T-064: Esc closes Details and gives the focus back to the toggle; a click outside closes it, a click inside does not', () => {
    const el = render(STATS) as HTMLElement & { detect: () => void };
    document.body.appendChild(el);
    try {
      const toggle = el.querySelector<HTMLButtonElement>('[data-testid="stats-details-toggle"]')!;
      toggle.click();
      el.detect();
      el.querySelector<HTMLElement>('[data-testid="stats-details"] dd')!.click(); // inside the overlay
      el.detect();
      expect(el.querySelector('[data-testid="stats-details"]')).not.toBeNull();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      el.detect();
      expect(el.querySelector('[data-testid="stats-details"]')).toBeNull();
      expect(document.activeElement).toBe(toggle);

      toggle.click();
      el.detect();
      document.body.click(); // outside
      el.detect();
      expect(el.querySelector('[data-testid="stats-details"]')).toBeNull();
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
    } finally {
      el.remove();
    }
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

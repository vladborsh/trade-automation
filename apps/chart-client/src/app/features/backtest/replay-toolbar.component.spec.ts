import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Timeframe } from '@trade-automation/contracts';
import { ReplayToolbarComponent } from './replay-toolbar.component';

function render(extra: Record<string, unknown> = {}) {
  TestBed.configureTestingModule({ imports: [ReplayToolbarComponent], providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(ReplayToolbarComponent);
  const inputs = { sessionName: 'BTC practice', cursorMs: Date.UTC(2026, 8, 18, 23, 45), timeframe: '5m', balance: 10000, currency: 'USD', ...extra };
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, cmp: fixture.componentInstance };
}

describe('ReplayToolbarComponent', () => {
  it('shows the session, the cursor in UTC, the active timeframe and the balance', () => {
    const { el } = render();
    expect(el.querySelector('.name')?.textContent).toBe('BTC practice');
    expect(el.querySelector('[data-testid="replay-cursor"]')?.textContent).toBe('2026-09-18 23:45 UTC');
    expect(el.querySelector('.tf-btn.active')?.textContent?.trim()).toBe('5m');
    expect(el.querySelector('[data-testid="replay-balance"]')?.textContent).toBe('10,000.00 USD');
  });

  it('emits step and timeframe changes', () => {
    const { el, cmp } = render();
    const steps: unknown[] = [];
    const tfs: Timeframe[] = [];
    cmp.step.subscribe(() => steps.push(1));
    cmp.timeframeChange.subscribe((tf) => tfs.push(tf));
    el.querySelector<HTMLButtonElement>('[data-testid="replay-step"]')!.click();
    [...el.querySelectorAll<HTMLButtonElement>('.tf-btn')].find((b) => b.textContent?.trim() === '1h')!.click();
    expect(steps).toHaveLength(1);
    expect(tfs).toEqual(['1h']);
  });

  it('shows loading and disables the step while candles are on their way', () => {
    const { el } = render({ loading: true });
    expect(el.querySelector('[data-testid="replay-loading"]')).not.toBeNull();
    expect(el.querySelector<HTMLButtonElement>('[data-testid="replay-step"]')!.disabled).toBe(true);
  });

  it('shows the end of the period and any error', () => {
    const { el } = render({ atEnd: true, error: 'HTTP 503' });
    expect(el.querySelector('[data-testid="replay-end"]')).not.toBeNull();
    expect(el.querySelector('[role="alert"]')?.textContent).toBe('HTTP 503');
  });
});

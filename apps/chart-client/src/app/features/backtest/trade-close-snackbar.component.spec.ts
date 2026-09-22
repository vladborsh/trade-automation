import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { CloseNotice } from '../../core/replay/close-notices';
import { CLOSE_NOTICE_MS, TradeCloseSnackbarComponent } from './trade-close-snackbar.component';

const notice = (over: Partial<CloseNotice>): CloseNotice => ({
  id: 1, orderId: 'o1', seq: 3, instrument: 'binance:BTCUSDT', side: 'long', reason: 'stop', pnlCcy: -99.5, pnlR: -1, ...over,
});

function render(notices: CloseNotice[]) {
  TestBed.configureTestingModule({ imports: [TradeCloseSnackbarComponent] });
  const fixture = TestBed.createComponent(TradeCloseSnackbarComponent);
  fixture.componentRef.setInput('notices', notices);
  fixture.componentRef.setInput('currency', 'USD');
  const dismissed: number[] = [];
  fixture.componentInstance.dismiss.subscribe((id) => dismissed.push(id));
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, dismissed };
}

describe('TradeCloseSnackbarComponent (T-051)', () => {
  afterEach(() => vi.useRealTimers());

  it('one snackbar per notice: instrument, direction, why it closed, P&L in currency and R', () => {
    const { el } = render([notice({}), notice({ id: 2, seq: 4, side: 'short', reason: 'take-profit', pnlCcy: 210, pnlR: 2.1 })]);
    const items = el.querySelectorAll('[data-testid="close-notice"]');
    expect(items).toHaveLength(2);
    expect(items[0].textContent!.replace(/\s+/g, ' ')).toContain('#3 binance:BTCUSDT long — stopped out');
    expect(items[0].querySelector('[data-testid="close-notice-pnl"]')!.textContent).toMatch(/99\.50 USD · .*1\.00 ?R/);
    expect(items[0].classList.contains('loss')).toBe(true);
    expect(items[1].textContent).toContain('target hit');
    expect(items[1].classList.contains('win')).toBe(true);
  });

  it('manual and end-of-session closes read as such; nothing is shown with no notices', () => {
    expect(render([notice({ reason: 'manual' })]).el.textContent).toContain('closed by hand');
    TestBed.resetTestingModule();
    expect(render([notice({ reason: 'end-of-session' })]).el.textContent).toContain('closed at the session end');
    TestBed.resetTestingModule();
    expect(render([]).el.querySelector('[data-testid="close-notices"]')).toBeNull();
  });

  it('× dismisses at once; each goes by itself after CLOSE_NOTICE_MS', () => {
    vi.useFakeTimers();
    const { el, dismissed } = render([notice({ id: 7 })]);
    el.querySelector<HTMLButtonElement>('.close')!.click();
    expect(dismissed).toEqual([7]);
    vi.advanceTimersByTime(CLOSE_NOTICE_MS);
    expect(dismissed).toEqual([7, 7]); // the timer fires too; dismissing an absent id is a no-op upstream
  });
});

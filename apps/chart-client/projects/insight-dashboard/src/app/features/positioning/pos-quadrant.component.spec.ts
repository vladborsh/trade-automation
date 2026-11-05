import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { WebPositioningResponse, WebPositioningRow } from '@trade-automation/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import captured from '../../../../../../e2e-insight-dashboard/fixtures/market-positioning.24h.json';
import { I18nService } from '../../i18n/i18n.service';
import { PosQuadrantComponent } from './pos-quadrant.component';

/**
 * IB-137 — the quadrant's view controls and its click / tap / keyboard paths. The unit DOM has no
 * `matchMedia`, so `hover` is false here: the touch path, unless a test stubs it.
 */
const data = captured as unknown as WebPositioningResponse;
// the fixture's own TRUMP row, moved to +38 % / +12 % (one row per symbol, as the server sends)
const fixtureTrump = data.rows.find((r) => r.symbol === 'TRUMPUSDT')!;
const trump: WebPositioningRow = {
  ...fixtureTrump, oiUsd: 1e8,
  priceChangePct: { ...data.rows[0].priceChangePct, value: 38 }, oiChangePct: { ...data.rows[0].oiChangePct, value: 12 },
};

const others = data.rows.filter((r) => r.symbol !== 'TRUMPUSDT');

function mount(rows: readonly WebPositioningRow[] = [...others, trump]) {
  TestBed.configureTestingModule({ imports: [PosQuadrantComponent], providers: [provideRouter([])] });
  TestBed.inject(I18nService).setLang('en');
  const f = TestBed.createComponent(PosQuadrantComponent);
  f.componentRef.setInput('rows', rows);
  f.componentRef.setInput('asOf', data.asOf);
  f.componentRef.setInput('period', '24h');
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const dot = (base: string) => [...el.querySelectorAll('g.dot')].find((g) => g.querySelector('title')?.textContent === base) as SVGGElement;
  const tap = (target: Element) => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    f.detectChanges();
  };
  return { f, el, dot, tap, nav: vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) };
}

afterEach(() => TestBed.resetTestingModule());

describe('PosQuadrantComponent — views (IB-137)', () => {
  it('opens on «без выбросов»: TRUMP +38 % / +12 % is pinned to the edge with its true values; «весь» brings it inside', () => {
    const { el, dot, tap } = mount();
    expect(el.querySelector('button.bulk')?.getAttribute('aria-pressed')).toBe('true');
    expect(dot('TRUMP').classList).toContain('pinned');
    expect(el.textContent).toContain('TRUMP +38 % / +12 %');
    expect(el.querySelector('button.bulk')?.textContent).toBe('without outliers');
    tap(el.querySelector('button.full')!);
    expect(dot('TRUMP').classList).not.toContain('pinned');
    expect(el.querySelector('button.full')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('+ zooms in (neither preset pressed, the chart pannable); «без выбросов» comes back from anywhere', () => {
    const { f, el, tap } = mount();
    const plot = el.querySelector('.plot') as HTMLElement;
    expect(plot.style.touchAction).toBe('pan-y'); // unzoomed: a swipe is the page's
    tap(el.querySelector('button.zoom.in')!);
    expect(el.querySelectorAll('.seg button[aria-pressed="true"]')).toHaveLength(0);
    expect(plot.style.touchAction).toBe('none');
    expect(f.componentInstance.domain().xMax).toBeCloseTo(5 / 1.5);
    tap(el.querySelector('button.bulk')!);
    expect(plot.style.touchAction).toBe('pan-y');
  });

  it('− from «без выбросов» stops at «весь» and presses it', () => {
    const { el, tap } = mount();
    for (let i = 0; i < 10; i++) tap(el.querySelector('button.zoom.out')!);
    expect(el.querySelector('button.full')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('the quadrant names show only while the origin is in view', () => {
    const { f, el } = mount();
    expect(el.querySelectorAll('text.corner')).toHaveLength(4);
    f.componentInstance.view.set({ mode: 'custom', domain: { xMin: 1, xMax: 5, yMin: 1, yMax: 5 } });
    f.detectChanges();
    expect(el.querySelectorAll('text.corner')).toHaveLength(0);
    expect([...el.querySelectorAll('text.zero')].map((t) => t.textContent)).toEqual(['0 ↓', '← 0']);
  });
});

describe('PosQuadrantComponent — open a coin (IB-137)', () => {
  it('touch: the first tap shows the numbers with «Open →» to R4\'s link; the second tap on the dot opens it', () => {
    const { el, dot, tap, nav } = mount();
    tap(dot('BTC').querySelector('circle')!);
    const tip = el.querySelector('.tip')!;
    expect(tip.textContent).toContain('BTC: price');
    const a = tip.querySelector('a.open') as HTMLAnchorElement;
    expect(a.textContent).toContain('Open →');
    expect(a.getAttribute('href')).toBe(`/instrument/BTCUSDT?at=${data.asOf - 86_400}&span=24h`);
    expect(nav).not.toHaveBeenCalled();
    tap(dot('BTC').querySelector('circle')!);
    expect(nav).toHaveBeenCalledWith(['/instrument', 'BTCUSDT'], { queryParams: { at: data.asOf - 86_400, span: '24h' } });
  });

  it('touch: a tap on the chart\'s background, or anywhere outside it, closes the numbers', () => {
    const { el, dot, tap } = mount();
    tap(dot('ETH').querySelector('circle')!);
    expect(el.querySelector('.tip')).not.toBeNull();
    tap(el.querySelector('rect.bg')!);
    expect(el.querySelector('.tip')).toBeNull();
    tap(dot('ETH').querySelector('circle')!);
    tap(document.body);
    expect(el.querySelector('.tip')).toBeNull();
  });

  it('a pinned coin opens the same way', () => {
    const { dot, tap, nav } = mount();
    tap(dot('TRUMP').querySelector('path')!);
    tap(dot('TRUMP').querySelector('path')!);
    expect(nav).toHaveBeenCalledWith(['/instrument', 'TRUMPUSDT'], expect.anything());
  });

  it('pointer device: one click opens; hovering shows the numbers without a link', () => {
    const { f, el, dot, tap, nav } = mount();
    (f.componentInstance as { hover: boolean }).hover = true;
    dot('SOL').dispatchEvent(new MouseEvent('mouseenter'));
    f.detectChanges();
    expect(el.querySelector('.tip')?.textContent).toContain('SOL: price');
    expect(el.querySelector('.tip a')).toBeNull();
    tap(dot('SOL').querySelector('circle')!);
    expect(nav).toHaveBeenCalledWith(['/instrument', 'SOLUSDT'], expect.anything());
  });

  it('keyboard: every dot is focusable, in OI order; Enter opens', () => {
    const { el, dot, nav } = mount();
    const order = [...el.querySelectorAll('g.dot')].map((g) => g.getAttribute('data-symbol'));
    const byOi = [...others, trump].sort((a, b) => (b.oiUsd ?? 0) - (a.oiUsd ?? 0)).map((r) => r.symbol);
    expect(order).toEqual(byOi);
    expect([...el.querySelectorAll('g.dot')].every((g) => g.getAttribute('tabindex') === '0')).toBe(true);
    dot('XRP').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(nav).toHaveBeenCalledWith(['/instrument', 'XRPUSDT'], expect.anything());
  });
});

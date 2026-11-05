import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { WebInsightBlockLine, WebLiquidationBlock, WebLiquidationsOverviewResponse } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import blockFixture from '../../../../../../../../libs/contracts/test/fixtures/liquidation-block.24h.json';
import { routes } from '../../app.routes';
import { I18nService } from '../../i18n/i18n.service';
import { LiquidationsBlockComponent } from './liquidations-block.component';

/**
 * IB-089 — the block as a COMPOSITION on the contract fixture (30-day norm, an outlier hour, a BTC
 * verdict, a 4-event series, TradFi): the layout specs prove the numbers, this proves they reach
 * the page in words, and that the first week says why instead of drawing nothing.
 */
const block = blockFixture as unknown as WebLiquidationBlock;
const overview = (over: Partial<WebLiquidationBlock> = {}): WebLiquidationsOverviewResponse => ({
  asOf: block.hourly.buckets.at(-1)!.time + 1_800, windows: [], perCoin: [], feed: [], feedMinUsd: 0, unmappedRows: 0,
  venues: { present: ['binance', 'bybit'], missing: ['okx'] }, block: { ...block, ...over },
});

function render(o: WebLiquidationsOverviewResponse, line: WebInsightBlockLine | null = null, nowSec = 1_793_700_000, period: '1h' | '24h' | '7d' = '24h') {
  TestBed.configureTestingModule({ imports: [LiquidationsBlockComponent], providers: [provideRouter([])] });
  TestBed.inject(I18nService).setLang('en');
  const f = TestBed.createComponent(LiquidationsBlockComponent);
  f.componentRef.setInput('overview', o);
  f.componentRef.setInput('period', period);
  f.componentRef.setInput('line', line);
  f.componentRef.setInput('nowSec', nowSec);
  f.detectChanges();
  return f.nativeElement as HTMLElement;
}

describe('LiquidationsBlockComponent (IB-089)', () => {
  it('draws the three charts with the norm, its outlier «×», the verdict, the cards and TradFi outside the totals', () => {
    const el = render(overview());
    expect(el.querySelectorAll('app-liq-hourly rect.short')).toHaveLength(24);
    expect(el.querySelectorAll('app-liq-hourly line.norm')).toHaveLength(2);
    expect(el.querySelector('app-liq-hourly text.callout')?.textContent?.trim()).toMatch(/^×\d/);
    expect(el.querySelector('app-liq-where')?.textContent).toContain('longs ×2.4');
    expect(el.querySelectorAll('app-liq-large circle')).toHaveLength(3);
    expect(el.querySelector('app-liq-large .card')?.textContent).toContain('×180 the median event');
    expect(el.querySelector('app-liq-large .card')?.getAttribute('href')).toMatch(/^\/instrument\/BTCUSDT\?at=\d+$/);
    expect(el.textContent).toContain('TradFi (gold, oil, indices): $3.2M, outside the totals');
    expect(el.textContent).toContain('OKX: no data');
    expect(el.textContent).toContain('data: Binance, Bybit');
  });

  it('the first week: no norm line, no «×», and the day the norm appears said in words', () => {
    const young = { ...block.hourly.basis, unavailable: 'insufficient_history' as const };
    const el = render(overview({
      hourly: { ...block.hourly, norm: { long: null, short: null, total: null }, basis: young, buckets: block.hourly.buckets.map((b) => ({ ...b, outlier: false, rarity: null })) },
      basis: young,
      perCoin: block.perCoin.map((c) => ({ ...c, verdict: null, basis: young })),
      large: block.large.map((e) => ({ ...e, xMedian: null })),
      availableFrom: { '1h': null, '4h': null, '24h': null, '7d': 1_794_269_312 },
    }));
    expect(el.querySelectorAll('app-liq-hourly line.norm')).toHaveLength(0);
    expect(el.querySelector('app-liq-hourly text.callout')).toBeNull();
    // no ratio to a norm that does not exist yet (IB-108: the side verdict «longs ×2.7» is a different number and stays)
    expect(el.querySelector('app-liq-where .norm')).toBeNull();
    expect(el.querySelector('app-liq-where')?.textContent).not.toContain('of the norm');
    expect(el.querySelector('app-liq-where .side')).not.toBeNull();
    expect(el.querySelector('app-liq-hourly')?.textContent).toContain('normal appears on 2026-11-10');
    expect(el.querySelector('app-liq-large')?.textContent).toContain('normal appears on 2026-11-10');
  });

  it('IB-120: «All liquidations (N) →» is a router link to /liquidations at Market\'s period — a real route, never a bare #href', () => {
    const link = (p: '1h' | '24h' | '7d') => {
      TestBed.resetTestingModule();
      return render(overview(), null, 1_793_700_000, p).querySelector('app-liq-large a.more') as HTMLAnchorElement;
    };
    expect(link('7d').getAttribute('href')).toBe('/liquidations?p=7d');
    expect(link('1h').getAttribute('href')).toBe('/liquidations?p=24h');
    const a = link('24h');
    expect(a.getAttribute('href')).toBe('/liquidations?p=24h');
    expect(a.textContent?.trim()).toBe(`All liquidations (${block.large.length}) →`);
    expect(routes.some((r) => r.path === 'liquidations' && r.loadComponent !== undefined)).toBe(true);
    // the fold stays at 8 cards; the rest are on the page
    expect(a.closest('app-liq-large')?.querySelectorAll('.card').length).toBeLessThanOrEqual(8);
  });

  it('ends with the block line: the neutral reason when nothing passed', () => {
    const basis = { window: '24h', venues: ['binance'], sampleWindows: 0, observedWindows: 0, from: null };
    const el = render(overview(), { block: 'liquidations', statement: null, neutral: { key: 'insight.neutral', reason: 'insufficient_history', basis } } as never);
    expect(el.querySelector('app-block-conclusion')?.textContent).toContain('Not enough history yet for conclusions');
  });
});

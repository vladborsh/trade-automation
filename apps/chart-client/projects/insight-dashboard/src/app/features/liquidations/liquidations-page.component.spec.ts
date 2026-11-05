import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { WebLiquidationsLargeQuery, WebLiquidationsLargeResponse } from '@trade-automation/contracts';
import { WEB_LIQUIDATIONS_LARGE_LIMIT } from '@trade-automation/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../../../../../../libs/contracts/test/fixtures/liquidations-large.24h.json';
import { routes } from '../../app.routes';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import { HELP_SEEN_PREFIX } from '../../ui/help-block-state';
import { LiquidationsPageComponent } from './liquidations-page.component';

/**
 * IB-120 — /liquidations as the reader gets it: the URL's filters reach the API and survive a
 * reload, a chip writes the URL and asks again, the table sorts, a row opens the coin at that
 * minute, a truncated answer says so, and the help is the mockup's text, open on the first visit.
 */
const answer = (query: WebLiquidationsLargeQuery, over: Partial<WebLiquidationsLargeResponse> = {}): WebLiquidationsLargeResponse =>
  ({ ...(fixture as unknown as WebLiquidationsLargeResponse), query, ...over });

async function open(url: string, lang: 'ru' | 'en' = 'en', respond = (q: WebLiquidationsLargeQuery) => answer(q)) {
  const calls: WebLiquidationsLargeQuery[] = [];
  TestBed.configureTestingModule({
    imports: [LiquidationsPageComponent],
    providers: [
      provideRouter([{ path: 'liquidations', component: LiquidationsPageComponent }]),
      { provide: InsightApiClient, useValue: { liquidationsLarge: async (q: WebLiquidationsLargeQuery) => (calls.push(q), respond(q)) } },
    ],
  });
  TestBed.inject(I18nService).setLang(lang);
  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);
  const f = TestBed.createComponent(LiquidationsPageComponent);
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const column = (cls: string) => [...el.querySelectorAll(`app-liq-table tbody td.${cls}`)].map((td) => td.textContent?.trim());
  return { f, el, router, calls, column };
}

beforeEach(() => localStorage.removeItem(`${HELP_SEEN_PREFIX}liquidations`));
afterEach(() => {
  vi.restoreAllMocks();
  TestBed.resetTestingModule();
});

describe('LiquidationsPageComponent (IB-120)', () => {
  it('is a route of the app, reached by link (no nav item)', () => {
    expect(routes.some((r) => r.path === 'liquidations' && r.loadComponent !== undefined)).toBe(true);
  });

  it('asks the API with the URL\'s filters — a link or a reload shows the same view', async () => {
    const { calls, el } = await open('/liquidations?p=7d&coin=BTCUSDT&min=1000000&side=short&venue=okx');
    expect(calls).toEqual([{ period: '7d', symbol: 'BTCUSDT', minUsd: 1_000_000, side: 'short', venue: 'okx' }]);
    expect(el.querySelector('app-liq-filters .pill.on[data-side="short"]')).not.toBeNull();
    expect((el.querySelector('app-liq-filters select') as HTMLSelectElement).value).toBe('BTCUSDT');
  });

  it('draws the bubble chart and the table from the answer', async () => {
    const { el, column } = await open('/liquidations');
    expect(el.querySelectorAll('app-liq-bubbles circle')).toHaveLength(fixture.rows.length);
    expect(column('base')).toEqual(fixture.rows.map((r) => r.base));
    expect(column('series')).toEqual(['—', '44 in 9 min', '44 in 9 min', '44 in 9 min', '—', '—']);
    expect(column('venue')[1]).toBe('OKX');
  });

  it('a chip writes the URL and asks again; the side chip toggles back to both', async () => {
    const { f, el, router, calls } = await open('/liquidations');
    const navigate = vi.spyOn(router, 'navigate');
    const longs = el.querySelector('app-liq-filters .pill[data-side="long"]') as HTMLButtonElement;
    longs.click();
    f.detectChanges();
    await f.whenStable();
    expect(navigate.mock.calls.at(-1)?.[1]?.queryParams).toMatchObject({ side: 'long', p: null });
    expect(calls.at(-1)?.side).toBe('long');
    longs.click();
    f.detectChanges();
    await f.whenStable();
    expect(navigate.mock.calls.at(-1)?.[1]?.queryParams).toMatchObject({ side: null });
    expect(calls.at(-1)?.side).toBe('all');
  });

  it('a header sorts the table and writes the sort into the URL; a second tap flips it', async () => {
    const { f, el, router, column } = await open('/liquidations');
    const navigate = vi.spyOn(router, 'navigate');
    const usd = el.querySelector('app-liq-table th.usd button') as HTMLButtonElement;
    usd.click();
    f.detectChanges();
    expect(column('usd')).toEqual(['$11M', '$9.7M', '$5.7M', '$1.2M', '$240K', '$130K']);
    expect(navigate.mock.calls.at(-1)?.[1]?.queryParams).toMatchObject({ sort: 'usd', dir: 'desc' });
    usd.click();
    f.detectChanges();
    expect(column('usd')[0]).toBe('$130K');
    expect(el.querySelector('app-liq-table th.usd')?.getAttribute('aria-sort')).toBe('ascending');
  });

  it('opens on the URL\'s sort', async () => {
    const { column } = await open('/liquidations?sort=base&dir=asc');
    expect(column('base')).toEqual(['BTC', 'BTC', 'BTC', 'DOGE', 'ETH', 'SOL']);
  });

  it('a row opens the coin\'s chart at that minute: /instrument/<SYM>?at=<time>', async () => {
    const { el, router } = await open('/liquidations');
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    (el.querySelectorAll('app-liq-table tbody tr')[1] as HTMLElement).click();
    expect(navigate).toHaveBeenCalledWith(['/instrument', 'BTCUSDT'], { queryParams: { at: fixture.rows[1].time } });
    expect(el.querySelectorAll('app-liq-table tbody td.base a')[1].getAttribute('href')).toBe(`/instrument/BTCUSDT?at=${fixture.rows[1].time}`);
  });

  it('a truncated answer says «showing the latest 1 000 of N»; an untruncated one gives the count', async () => {
    const many = Array.from({ length: WEB_LIQUIDATIONS_LARGE_LIMIT }, (_, i) => ({ ...fixture.rows[0], time: fixture.rows[0].time - i }));
    const { el } = await open('/liquidations?p=7d', 'ru', (q) => answer(q, { rows: many as WebLiquidationsLargeResponse['rows'], total: 4_321, truncated: true }));
    expect(el.querySelector('.foot')?.textContent?.trim()).toBe('показаны 1 000 последних из 4 321');
    TestBed.resetTestingModule();
    const small = await open('/liquidations');
    expect(small.el.querySelector('.foot')?.textContent?.trim()).toBe('liquidations: 6 · sort by any column');
    // renders 1 000 table rows: 1.5 s alone, 6.8 s inside the parallel `npm test` (dev-1, 2026-11-05) — past
    // vitest's 5 s default, so it carries its own budget rather than failing whenever the suite is busy
  }, 20_000);

  it('no rows: says so instead of an empty table', async () => {
    const { el } = await open('/liquidations', 'en', (q) => answer(q, { rows: [], total: 0, truncated: false }));
    expect(el.querySelector('app-liq-table')).toBeNull();
    expect(el.textContent).toContain('No liquidations match these filters.');
  });

  it('price and venue cells are the ones marked to hide on a phone', async () => {
    const { el } = await open('/liquidations');
    const hidden = [...el.querySelectorAll('app-liq-table thead th.phone-hide')].map((th) => th.className.split(' ')[0]);
    expect(hidden).toEqual(['price', 'venue']);
    expect(el.querySelectorAll('app-liq-table tbody tr:first-child td.phone-hide')).toHaveLength(2);
  });

  it('the breadcrumb goes back to Market at the same period', async () => {
    const { el } = await open('/liquidations?p=7d');
    expect(el.querySelector('.crumbs a')?.getAttribute('href')).toBe('/market?p=7d');
  });
});

describe('«Как этим пользоваться» (IB-120)', () => {
  /** The mockup's help items, tags stripped — the text the task says to use verbatim. */
  function mockupItems(): string[] {
    const html = readFileSync(join(process.cwd(), '..', '..', 'architecture', 'mockups', 'market-2-2026-11-05', 'mockup.html'), 'utf8');
    const start = html.indexOf('<summary>Как этим пользоваться</summary>');
    const block = html.slice(start, html.indexOf('</details>', start));
    return [...block.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
  }

  it('is the mockup\'s text, word for word, including the Binance one-per-second caveat', async () => {
    const expected = mockupItems();
    expect(expected).toHaveLength(5);
    expect(expected.at(-1)).toContain('не больше одной ликвидации в секунду');
    const { el } = await open('/liquidations', 'ru');
    expect(el.querySelector('app-help-block summary')?.textContent?.trim()).toBe('Как этим пользоваться');
    const rendered = [...el.querySelectorAll('app-help-block li')].map((li) => li.textContent?.replace(/\s+/g, ' ').trim());
    expect(rendered).toEqual(expected);
  });

  it('open on the first visit, collapsed on the next', async () => {
    const first = await open('/liquidations');
    expect((first.el.querySelector('app-help-block details') as HTMLDetailsElement).open).toBe(true);
    TestBed.resetTestingModule();
    const second = await open('/liquidations');
    expect((second.el.querySelector('app-help-block details') as HTMLDetailsElement).open).toBe(false);
  });

  it('open when localStorage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    const { el } = await open('/liquidations');
    expect((el.querySelector('app-help-block details') as HTMLDetailsElement).open).toBe(true);
  });
});

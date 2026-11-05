import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { WebLiquidationEpisodesResponse, WebLiquidationsLargeQuery, WebLiquidationsLargeResponse } from '@trade-automation/contracts';
import { WEB_LIQUIDATIONS_LARGE_LIMIT, WebLiquidationEpisodesResponseSchema } from '@trade-automation/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../../../../../../libs/contracts/test/fixtures/liquidations-large.24h.json';
import episodesFixture from '../../../../../../../../libs/contracts/test/fixtures/liquidation-episodes.7d.json';
import collectingFixture from '../../../../../../../../libs/contracts/test/fixtures/liquidation-episodes.collecting.json';
import { routes } from '../../app.routes';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import { HELP_SEEN_PREFIX } from '../../ui/help-block-state';
import { LiquidationsPageComponent } from './liquidations-page.component';

/**
 * IB-120 / IB-134 — /liquidations as the reader gets it. The episode view (IB-134): the summary, the
 * cards, the fold and the link to the flat list, the zero and the collecting states. The flat list
 * (IB-120, now `?view=list`): the URL's filters reach the API and survive a reload, a chip writes the
 * URL and asks again, the table sorts, a row opens the coin at that minute, a truncated answer says
 * so. The help is E9's text, open on the first visit.
 */
const answer = (query: WebLiquidationsLargeQuery, over: Partial<WebLiquidationsLargeResponse> = {}): WebLiquidationsLargeResponse =>
  ({ ...(fixture as unknown as WebLiquidationsLargeResponse), query, ...over });
/** The contract's 7d fixture (4 episodes ≥ T $23.9M, 3 shown, 1 folded), answered for the query asked. */
const episodes = (query: WebLiquidationsLargeQuery, over: Partial<WebLiquidationEpisodesResponse> = {}): WebLiquidationEpisodesResponse =>
  WebLiquidationEpisodesResponseSchema.parse({ ...episodesFixture, query, ...over });
const none = (query: WebLiquidationsLargeQuery) => episodes(query, { summary: { count: 0, shorts: 0, longs: 0, largestId: null }, episodes: [], folded: 0 });
const collecting = (query: WebLiquidationsLargeQuery) => WebLiquidationEpisodesResponseSchema.parse({ ...collectingFixture, query });

async function open(
  url: string, lang: 'ru' | 'en' = 'en',
  respond = (q: WebLiquidationsLargeQuery) => answer(q),
  respondEpisodes: (q: WebLiquidationsLargeQuery) => WebLiquidationEpisodesResponse = episodes,
) {
  const calls: WebLiquidationsLargeQuery[] = [];
  const episodeCalls: WebLiquidationsLargeQuery[] = [];
  TestBed.configureTestingModule({
    imports: [LiquidationsPageComponent],
    providers: [
      provideRouter([{ path: 'liquidations', component: LiquidationsPageComponent }, { path: '**', children: [] }]),
      {
        provide: InsightApiClient,
        useValue: {
          liquidationsLarge: async (q: WebLiquidationsLargeQuery) => (calls.push(q), respond(q)),
          liquidationEpisodes: async (q: WebLiquidationsLargeQuery) => (episodeCalls.push(q), respondEpisodes(q)),
        },
      },
    ],
  });
  TestBed.inject(I18nService).setLang(lang);
  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);
  const f = TestBed.createComponent(LiquidationsPageComponent);
  // two requests in a row (episodes, then the flat list when it is shown): settle twice
  for (let i = 0; i < 2; i += 1) {
    f.detectChanges();
    await f.whenStable();
  }
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const column = (cls: string) => [...el.querySelectorAll(`app-liq-table tbody td.${cls}`)].map((td) => td.textContent?.trim());
  const settle = async () => {
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
  };
  return { f, el, router, calls, episodeCalls, column, settle };
}

beforeEach(() => localStorage.removeItem(`${HELP_SEEN_PREFIX}liquidations`));
afterEach(() => {
  vi.restoreAllMocks();
  TestBed.resetTestingModule();
});

describe('LiquidationsPageComponent — the flat list (IB-120, `?view=list` since IB-134)', () => {
  it('is a route of the app', () => {
    expect(routes.some((r) => r.path === 'liquidations' && r.loadComponent !== undefined)).toBe(true);
  });

  it('asks the API with the URL\'s filters — a link or a reload shows the same view', async () => {
    const { calls, episodeCalls, el } = await open('/liquidations?p=7d&coin=BTCUSDT&min=1000000&side=short&venue=okx&view=list');
    expect(calls).toEqual([{ period: '7d', symbol: 'BTCUSDT', minUsd: 1_000_000, side: 'short', venue: 'okx' }]);
    expect(episodeCalls).toEqual(calls);
    expect(el.querySelector('app-liq-filters .pill.on[data-side="short"]')).not.toBeNull();
    expect((el.querySelector('app-liq-filters select') as HTMLSelectElement).value).toBe('BTCUSDT');
  });

  it('draws the table from the answer — and no bubble chart: Market draws that one (owner ruling 1)', async () => {
    const { el, column } = await open('/liquidations?view=list');
    expect(el.querySelector('app-liq-bubbles')).toBeNull();
    expect(el.querySelector('app-liq-episodes')).toBeNull();
    expect(column('base')).toEqual(fixture.rows.map((r) => r.base));
    expect(column('series')).toEqual(['—', '44 in 9 min', '44 in 9 min', '44 in 9 min', '—', '—']);
    expect(column('venue')[1]).toBe('OKX');
  });

  it('a chip writes the URL and asks again; the side chip toggles back to both', async () => {
    const { f, el, router, calls } = await open('/liquidations?view=list');
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
    const { f, el, router, column } = await open('/liquidations?view=list');
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
    const { column } = await open('/liquidations?view=list&sort=base&dir=asc');
    expect(column('base')).toEqual(['BTC', 'BTC', 'BTC', 'DOGE', 'ETH', 'SOL']);
  });

  it('a row opens the coin\'s chart at that minute: /instrument/<SYM>?at=<time>', async () => {
    const { el, router } = await open('/liquidations?view=list');
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    (el.querySelectorAll('app-liq-table tbody tr')[1] as HTMLElement).click();
    expect(navigate).toHaveBeenCalledWith(['/instrument', 'BTCUSDT'], { queryParams: { at: fixture.rows[1].time } });
    expect(el.querySelectorAll('app-liq-table tbody td.base a')[1].getAttribute('href')).toBe(`/instrument/BTCUSDT?at=${fixture.rows[1].time}`);
  });

  it('a truncated answer says «showing the latest 1 000 of N»; an untruncated one gives the count', async () => {
    const many = Array.from({ length: WEB_LIQUIDATIONS_LARGE_LIMIT }, (_, i) => ({ ...fixture.rows[0], time: fixture.rows[0].time - i }));
    const { el } = await open('/liquidations?view=list&p=7d', 'ru', (q) => answer(q, { rows: many as WebLiquidationsLargeResponse['rows'], total: 4_321, truncated: true }));
    expect(el.querySelector('.foot')?.textContent?.trim()).toBe('показаны 1 000 последних из 4 321');
    TestBed.resetTestingModule();
    const small = await open('/liquidations?view=list');
    expect(small.el.querySelector('.foot')?.textContent?.trim()).toBe('liquidations: 6 · sort by any column');
    // renders 1 000 table rows: 1.5 s alone, 6.8 s inside the parallel `npm test` (dev-1, 2026-11-05) — past
    // vitest's 5 s default, so it carries its own budget rather than failing whenever the suite is busy
  }, 20_000);

  it('no rows: says so instead of an empty table', async () => {
    const { el } = await open('/liquidations?view=list', 'en', (q) => answer(q, { rows: [], total: 0, truncated: false }));
    expect(el.querySelector('app-liq-table')).toBeNull();
    expect(el.textContent).toContain('No liquidations match these filters.');
  });

  it('price and venue cells are the ones marked to hide on a phone', async () => {
    const { el } = await open('/liquidations?view=list');
    const hidden = [...el.querySelectorAll('app-liq-table thead th.phone-hide')].map((th) => th.className.split(' ')[0]);
    expect(hidden).toEqual(['price', 'venue']);
    expect(el.querySelectorAll('app-liq-table tbody tr:first-child td.phone-hide')).toHaveLength(2);
  });

  it('«← эпизоды» goes back to the episode view with the same filters, by router link', async () => {
    const { el } = await open('/liquidations?view=list&p=7d&side=short');
    expect(el.querySelector('a.back')?.getAttribute('href')).toBe('/liquidations?p=7d&side=short');
  });
});

describe('LiquidationsPageComponent — episodes (IB-134)', () => {
  const cards = (el: HTMLElement) => [...el.querySelectorAll('app-liq-episode-card')] as HTMLElement[];
  const text = (n: Element | null | undefined) => n?.textContent?.replace(/\s+/g, ' ').trim();

  it('is the default view: asks for episodes, not for the flat list, and draws no table', async () => {
    const { el, calls, episodeCalls } = await open('/liquidations?p=7d');
    expect(episodeCalls).toHaveLength(1);
    expect(calls).toEqual([]);
    expect(el.querySelector('app-liq-table')).toBeNull();
    expect(cards(el)).toHaveLength(3);
  });

  it('the summary counts every episode ≥ T before the cap, with plurals and the largest (E4)', async () => {
    const { el } = await open('/liquidations?p=7d', 'ru');
    const headline = text(el.querySelector('.headline'));
    expect(headline).toMatch(/^За 7 дней — 4 эпизода: 3 раза выбивали шортов, 1 раз лонгов\. Крупнейший — \d\d\/\d\d \d\d:\d\d, BTC, \$100M за 23 минуты\.$/);
    expect(text(el.querySelector('.anno'))).toContain('уже есть на «Рынке» — здесь их нет');
    expect(el.querySelector('.anno a')?.getAttribute('href')).toBe('/market?p=7d');
  });

  it('cards by sum; the single print says «за 1 минуту»; no price → «нет цены»; +4 h not passed → «ещё не прошло»', async () => {
    const { el } = await open('/liquidations?p=7d', 'ru');
    const [first, second, third] = cards(el);
    expect(text(first.querySelector('.sum'))).toBe('$100M');
    expect(text(first.querySelector('.side'))).toBe('Шорты выбиты');
    expect(text(first.querySelector('.lead'))).toBe('183 ликвидации за 23 минуты.');
    expect(first.querySelectorAll('.what .chips')).toHaveLength(2); // coins and venues
    expect(text(second.querySelector('.side'))).toBe('Лонги выбиты');
    expect(second.querySelectorAll('.what .chips')).toHaveLength(1); // one venue: no venue chips
    expect(text(second.querySelectorAll('.fact')[1])).toBe('через 4 ч: ещё не прошло');
    expect(text(third.querySelector('.lead'))).toBe('1 ликвидация за 1 минуту.');
    expect(third.querySelector('svg')).toBeNull();
    expect(text(third.querySelector('.no-price'))).toBe('нет цены');
  });

  it('the price label and the link name the same coin — the largest — and the link is /instrument/<SYM>?at=<from>', async () => {
    const { el } = await open('/liquidations?p=7d', 'ru');
    const fx = episodesFixture.episodes;
    cards(el).forEach((card, i) => {
      const a = card.querySelector('a.open-link');
      expect(a?.getAttribute('href')).toBe(`/instrument/${fx[i].coins[0].symbol}?at=${fx[i].from}`);
      expect(text(a)).toMatch(new RegExp(`^Открыть ${fx[i].coins[0].base} в \\d\\d:\\d\\d →$`));
      const during = card.querySelector('.fact');
      if (during) expect(text(during)).toMatch(new RegExp(`^${fx[i].coins[0].base} во время:`));
    });
  });

  it('a tap opens the largest prints (no request); the link does not toggle; empty after `min` says so', async () => {
    const { el, settle, episodeCalls } = await open('/liquidations?p=7d&min=1000000', 'ru');
    const [first, second] = cards(el);
    (first.querySelector('.what') as HTMLElement).click();
    await settle();
    expect(first.querySelectorAll('.prints li')).toHaveLength(episodesFixture.episodes[0].prints.length);
    expect(first.querySelector('.lead')?.getAttribute('aria-expanded')).toBe('true');
    (first.querySelector('.lead') as HTMLElement).click();
    await settle();
    expect(first.querySelector('.prints')).toBeNull();
    (second.querySelector('.head') as HTMLElement).click();
    await settle();
    expect(text(second.querySelector('.prints'))).toBe('Нет ликвидаций от $1M в этом эпизоде.');
    expect(episodeCalls).toHaveLength(1);
  });

  it('the fold: «ещё 1 эпизод поменьше» and the list link with no count, keeping the filters', async () => {
    const { el } = await open('/liquidations?p=7d&side=short', 'ru');
    expect(text(el.querySelector('.fold'))).toBe('… ещё 1 эпизод поменьше · все ликвидации списком →');
    expect(el.querySelector('a.list-link')?.getAttribute('href')).toBe('/liquidations?p=7d&side=short&view=list');
  });

  it('following the list link shows the flat table and asks for it', async () => {
    const { el, router, settle, calls } = await open('/liquidations?p=7d', 'ru');
    await router.navigateByUrl('/liquidations?p=7d&view=list');
    await settle();
    await settle();
    expect(calls).toHaveLength(1);
    expect(el.querySelector('app-liq-table')).not.toBeNull();
    expect(el.querySelector('app-liq-episodes')).toBeNull();
  });

  it('zero episodes: «эпизодов не было (порог сейчас $T)», no cards, the list link still there', async () => {
    const { el } = await open('/liquidations', 'ru', answer, none);
    expect(text(el.querySelector('.headline'))).toBe('За 24 часа эпизодов не было (порог сейчас $24M).');
    expect(cards(el)).toHaveLength(0);
    expect(text(el.querySelector('a.list-link'))).toBe('все ликвидации списком →');
  });

  it('collecting: «копим историю для эпизодов: {h} ч» and the flat list instead of cards', async () => {
    const { el, calls } = await open('/liquidations', 'ru', answer, collecting);
    expect(text(el.querySelector('.collecting'))).toBe('Копим историю для эпизодов: 17 ч. Пока — все ликвидации списком.');
    expect(calls).toHaveLength(1);
    expect(el.querySelector('app-liq-table')).not.toBeNull();
    expect(cards(el)).toHaveLength(0);
  });

  it('a filtered coin and venue are highlighted on the card, the figures stay whole-episode (E5)', async () => {
    const { el } = await open('/liquidations?p=7d&venue=okx', 'ru');
    const first = cards(el)[0];
    expect(text(first.querySelector('.chip.on'))).toBe('OKX 11 %');
    expect(text(first.querySelector('.sum'))).toBe('$100M');
  });
});

describe('«Как этим пользоваться» (IB-120, rewritten for episodes by IB-134)', () => {
  it('is E9\'s text: the episode, the live threshold, the split, the minimum, the chart; the Binance caveat kept', async () => {
    const { el } = await open('/liquidations?p=7d', 'ru');
    expect(el.querySelector('app-help-block summary')?.textContent?.trim()).toBe('Как этим пользоваться');
    const items = [...el.querySelectorAll('app-help-block li')].map((li) => li.textContent?.replace(/\s+/g, ' ').trim() ?? '');
    expect(items).toHaveLength(7);
    expect(items[0]).toContain('подряд идущие ликвидации одной стороны от $100K, по всему рынку');
    expect(items[0]).toContain('с паузами меньше 3 минут');
    expect(items[1]).toContain('за последние 2.5 дн. превышали примерно 7–8 раз в неделю; сейчас $24M');
    expect(items[2]).toContain('(от 3 ликвидаций в пределах 10 минут от первой)');
    expect(items[4]).toBe('Фильтр «от $1M» не меняет эпизоды — только список ликвидаций внутри карточки и общий список.');
    expect(items[5]).toContain('по самой крупной монете эпизода');
    expect(items[5]).toContain('факт, не прогноз');
    expect(items[6]).toContain('не больше одной ликвидации в секунду');
    expect(items.join(' ')).not.toContain('$5M'); // E11.1: never a fixed dollar figure
  });

  it('while the norm is collecting the threshold sentence names no figure', async () => {
    const { el } = await open('/liquidations', 'ru', answer, collecting);
    const norm = el.querySelectorAll('app-help-block li')[1]?.textContent ?? '';
    expect(norm).toContain('Порог появится, когда накопятся сутки истории.');
    expect(norm).not.toMatch(/\$\d/);
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

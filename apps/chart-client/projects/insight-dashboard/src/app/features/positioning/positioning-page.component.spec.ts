import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { WebMarketPeriod, WebPositioningResponse } from '@trade-automation/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import positioningFixture from '../../../../../../../../libs/contracts/test/fixtures/positioning.24h.json';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import { PositioningPageComponent } from './positioning-page.component';

/**
 * IB-103 — /positioning as the reader gets it: the quadrant (moved here from Market) with its
 * «OI Binance» wording, the full table sorted by the URL's `?sort=&dir=`, a header tap that sorts
 * AND writes the URL, and the period asked of the same endpoint Market uses.
 */
const fixture = positioningFixture as unknown as WebPositioningResponse;

async function open(url: string) {
  const calls: WebMarketPeriod[] = [];
  TestBed.configureTestingModule({
    imports: [PositioningPageComponent],
    providers: [
      provideRouter([{ path: 'positioning', component: PositioningPageComponent }]),
      { provide: InsightApiClient, useValue: { marketPositioning: async (p: WebMarketPeriod) => (calls.push(p), fixture) } },
    ],
  });
  TestBed.inject(I18nService).setLang('en');
  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);
  const f = TestBed.createComponent(PositioningPageComponent);
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const tickers = () => [...el.querySelectorAll('app-pos-heat tbody th')].map((t) => t.textContent?.trim());
  return { f, el, router, calls, tickers };
}

afterEach(() => TestBed.resetTestingModule());

describe('PositioningPageComponent loaded hidden (IB-BUG-021)', () => {
  it('a /positioning tab opened in the background asks nothing until it is shown', async () => {
    vi.useFakeTimers();
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      const calls: WebMarketPeriod[] = [];
      TestBed.configureTestingModule({
        imports: [PositioningPageComponent],
        providers: [
          provideRouter([]),
          { provide: InsightApiClient, useValue: { marketPositioning: async (p: WebMarketPeriod) => (calls.push(p), fixture) } },
        ],
      });
      TestBed.createComponent(PositioningPageComponent).detectChanges();
      await vi.advanceTimersByTimeAsync(180_000);
      expect(calls).toEqual([]);
      vis.mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toHaveLength(1);
    } finally {
      vis.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe('PositioningPageComponent (IB-103)', () => {
  it('asks the same endpoint as Market for the URL\'s period, and draws the quadrant and the full table', async () => {
    const { el, calls, tickers } = await open('/positioning?p=4h');
    expect(calls).toEqual(['4h']);
    expect(el.querySelectorAll('app-pos-quadrant circle')).toHaveLength(4);
    expect(tickers()).toEqual(['SOL', 'ETH', 'BTC', 'DOGE']); // default: most unusual first
  });

  it('the OI in USD is ONE venue\'s, and says so: «OI Binance» in the tap text and the legend (moved from the Market block spec)', async () => {
    const { f, el } = await open('/positioning');
    const btc = [...el.querySelectorAll('app-pos-quadrant circle')].find((c) => c.querySelector('title')?.textContent === 'BTC') as SVGElement;
    btc.dispatchEvent(new MouseEvent('click'));
    f.detectChanges();
    const text = el.querySelector('app-pos-quadrant')?.textContent ?? '';
    expect(text).toContain('BTC: price −1.20 %, open interest +3.40 %, OI Binance $8.1B');
    expect(text).toContain('dot size: OI Binance in USD');
  });

  it('opens on the URL\'s sort — a link shows the same view', async () => {
    const { tickers } = await open('/positioning?sort=base&dir=desc');
    expect(tickers()).toEqual(['SOL', 'ETH', 'DOGE', 'BTC']);
  });

  it('a header tap sorts the table and writes the sort into the URL; a second tap flips it', async () => {
    const { f, el, router, tickers } = await open('/positioning?p=24h');
    const navigate = vi.spyOn(router, 'navigate');
    const coinHeader = el.querySelector('app-pos-heat thead th.coin button') as HTMLButtonElement;
    coinHeader.click();
    f.detectChanges();
    expect(tickers()).toEqual(['BTC', 'DOGE', 'ETH', 'SOL']);
    expect(navigate.mock.calls.at(-1)?.[1]?.queryParams).toEqual({ p: '24h', sort: 'base', dir: 'asc', q: null });
    coinHeader.click();
    f.detectChanges();
    expect(tickers()).toEqual(['SOL', 'ETH', 'DOGE', 'BTC']);
    expect(navigate.mock.calls.at(-1)?.[1]?.queryParams).toEqual({ p: '24h', sort: 'base', dir: 'desc', q: null });
  });

  it('a column\'s «rare» button sorts by that column\'s rarity', async () => {
    const { f, el } = await open('/positioning');
    const rare = el.querySelectorAll('app-pos-heat thead .by-rarity');
    expect(rare).toHaveLength(6); // one per heat column
    (rare[0] as HTMLButtonElement).click();
    f.detectChanges();
    expect((rare[0] as HTMLElement).classList.contains('on')).toBe(true);
  });

  it('a row opens the coin', async () => {
    const { el, router } = await open('/positioning');
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    (el.querySelector('app-pos-heat tbody tr') as HTMLElement).click();
    expect(navigate).toHaveBeenCalledWith(['/instrument', 'SOLUSDT']);
  });
});

describe('PositioningPageComponent search (IB-136)', () => {
  const type = (f: { detectChanges(): void }, el: HTMLElement, text: string) => {
    const input = el.querySelector('input[type="search"]') as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
  };

  it('typing filters the table by ticker and writes ?q= (trimmed) beside p and the sort; the quadrant keeps every coin', async () => {
    const { f, el, router, tickers } = await open('/positioning?p=24h&sort=base&dir=asc');
    const navigate = vi.spyOn(router, 'navigate');
    type(f, el, ' o ');
    expect(tickers()).toEqual(['DOGE', 'SOL']); // still in the URL's sort
    expect(navigate.mock.calls.at(-1)?.[1]?.queryParams).toEqual({ p: '24h', sort: 'base', dir: 'asc', q: 'o' });
    expect(el.querySelectorAll('app-pos-quadrant circle')).toHaveLength(4);
    type(f, el, '');
    expect(tickers()).toHaveLength(4);
    expect(navigate.mock.calls.at(-1)?.[1]?.queryParams).toEqual({ p: '24h', sort: 'base', dir: 'asc', q: null });
  });

  it('a query lifts the phone limit (the box is «expanded»); no query keeps it', async () => {
    const { f, el } = await open('/positioning');
    const box = () => el.querySelector('app-pos-heat .scroll') as HTMLElement;
    expect(box().classList.contains('expanded')).toBe(false);
    type(f, el, 'b');
    expect(box().classList.contains('expanded')).toBe(true);
    type(f, el, '   ');
    expect(box().classList.contains('expanded')).toBe(false); // spaces are no query
  });

  it('opens on the URL\'s query — a link (and a reload) shows the same search', async () => {
    const { el, tickers } = await open('/positioning?q=eth');
    expect((el.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('eth');
    expect(tickers()).toEqual(['ETH']);
  });

  it('no match: «No coins match «q»», no table, and «Clear» brings every row back', async () => {
    const { f, el, tickers } = await open('/positioning?q=zzz');
    expect(el.querySelector('app-pos-heat')).toBeNull();
    const empty = el.querySelector('.empty') as HTMLElement;
    expect(empty.textContent).toContain('No coins match «zzz»');
    (empty.querySelector('button') as HTMLButtonElement).click();
    f.detectChanges();
    expect(tickers()).toHaveLength(4);
    expect((el.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('');
  });

  it('in Russian', async () => {
    const { f, el } = await open('/positioning?q=zzz');
    TestBed.inject(I18nService).setLang('ru');
    f.detectChanges();
    expect(el.querySelector('.empty')?.textContent).toContain('Нет монет по «zzz»');
    expect((el.querySelector('input[type="search"]') as HTMLInputElement).placeholder).toBe('Найти монету');
  });
});

import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { WebCapsResponse, WebPositioningResponse } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import positioningFixture from '../../../../../../../../libs/contracts/test/fixtures/positioning.24h.json';
import { I18nService } from '../../i18n/i18n.service';
import { PositioningBlockComponent } from '../positioning/positioning-block.component';
import { CapsBlockComponent } from './caps-block.component';

/**
 * IB-090 — the two blocks as COMPOSITIONS: the layout specs prove the geometry, this proves the
 * refusals and the attribution reach the page in words (TL: «4h caps change shows the refusal
 * text», «CoinGecko attribution visible next to caps»), and that a missing rarity is hatched.
 */
const coin = (id: string, symbol: string, capUsd: number, changePct: number | null) => ({ id, symbol, name: id, capUsd, priceUsd: 1, changePct, stable: false });
const caps = (over: Partial<WebCapsResponse> = {}): WebCapsResponse => ({
  period: '24h',
  coins: [coin('bitcoin', 'BTC', 1.5e12, 1.2), coin('ethereum', 'ETH', 2.8e11, -2.1), coin('solana', 'SOL', 5.5e10, 0.3)],
  coinsUnavailable: null, changeUnavailable: null, dominanceUnavailable: null,
  dominance: { btcPct: 59, ethPct: 11, stablesPct: 8, restPct: 22, totalCapUsd: 2.6e12, totalCapChangePct24h: -1, stablesCounted: 10, asOf: '2026-11-03T17:00:00Z' },
  source: { name: 'CoinGecko', url: 'https://www.coingecko.com' }, generatedAt: '2026-11-03T17:00:00Z',
  ...over,
});

function render<T>(cmp: Type<T>, inputs: Record<string, unknown>): HTMLElement {
  TestBed.configureTestingModule({ imports: [cmp], providers: [provideRouter([])] });
  TestBed.inject(I18nService).setLang('en');
  const f = TestBed.createComponent(cmp);
  for (const [k, v] of Object.entries(inputs)) f.componentRef.setInput(k, v);
  f.detectChanges();
  return f.nativeElement as HTMLElement;
}

describe('CapsBlockComponent (IB-090)', () => {
  it('24h: coloured tiles, the dominance bar summing to the width, CoinGecko credited as a link', () => {
    const el = render(CapsBlockComponent, { caps: caps(), period: '24h' });
    const fills = [...el.querySelectorAll('app-caps-treemap rect')].map((r) => r.getAttribute('fill'));
    expect(fills).toHaveLength(3);
    expect(new Set(fills).size).toBe(3); // up, down and small-up are three different colours
    const source = el.querySelector('a.source') as HTMLAnchorElement;
    expect(source.textContent?.trim()).toBe('Data: CoinGecko');
    expect(source.getAttribute('href')).toBe('https://www.coingecko.com');
    expect(el.querySelectorAll('app-dominance-bar .seg')).toHaveLength(4);
    expect(el.textContent).toContain('stablecoins');
  });

  it('4h: the source publishes no change — neutral tiles and the refusal said in words', () => {
    const el = render(CapsBlockComponent, {
      caps: caps({ period: '4h', changeUnavailable: 'period_not_served', coins: caps().coins.map((c) => ({ ...c, changePct: null })) }),
      period: '4h',
    });
    const fills = new Set([...el.querySelectorAll('app-caps-treemap rect')].map((r) => r.getAttribute('fill')));
    expect(fills).toEqual(new Set(['#21262d']));
    expect(el.textContent).toContain('CoinGecko does not publish a 4h change, so the tiles are not coloured.');
    expect(el.querySelector('a.source')).not.toBeNull(); // credited whatever the period
  });

  it('a refused bar and a refused list are said, not left blank', () => {
    const el = render(CapsBlockComponent, { caps: caps({ coins: [], coinsUnavailable: 'source_unavailable', dominance: null, dominanceUnavailable: 'sources_disagree' }), period: '24h' });
    expect(el.textContent).toContain('CoinGecko did not answer');
    expect(el.textContent).toContain('add up to more than 100 %');
    expect(el.querySelector('app-caps-treemap')).toBeNull();
  });
});

describe('PositioningBlockComponent (IB-090)', () => {
  it('dots for every coin, rows sorted most-unusual first, a missing rarity hatched with its reason', () => {
    const el = render(PositioningBlockComponent, { positioning: positioningFixture as unknown as WebPositioningResponse, period: '24h' });
    expect(el.querySelectorAll('app-pos-quadrant circle')).toHaveLength(4);
    expect([...el.querySelectorAll('app-pos-heat tbody th')].map((t) => t.textContent?.trim())).toEqual(['SOL', 'ETH', 'BTC', 'DOGE']);
    const liq = el.querySelector('app-pos-heat tbody tr td:nth-of-type(6)') as HTMLElement;
    expect(liq.getAttribute('data-heat')).toBe('none');
    expect(liq.getAttribute('title')).toBe('not enough history yet (under 20 days)');
    expect(el.textContent).toContain('crowd in longs');
  });
});

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { WebInsightStatement } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import { I18nService } from '../../../i18n/i18n.service';
import { InsightCardComponent } from './insight-card.component';
import { dayMonth, timeOfDay } from '../../../shared/time-format';

/** IB-152: the card's clock is the viewer's (time-format.spec pins the zones themselves). */
const AT3 = timeOfDay(Date.UTC(2026, 10, 4, 3, 0) / 1000);

/** IB-107 — the card as the page draws it: chip, words, figures in the number face; IB-119 — the chart beside them. */
const NOW = Date.UTC(2026, 10, 4, 14) / 1000;
const T0 = Date.UTC(2026, 10, 4, 3) / 1000 - 120;
const r3: WebInsightStatement = {
  ruleId: 'R3', block: 'liquidations', key: 'insight.liq_cascade', params: { side: 'long', count: 21, minutes: 9, usd: 14_400_000, symbol: 'BTCUSDT' },
  rarity: 0.97, magnitude: 14_400_000, basis: { window: '24h', venues: ['binance', 'bybit', 'okx'], sampleWindows: 697, observedWindows: 690, from: Date.UTC(2026, 9, 5) / 1000 },
  link: { route: 'instrument', symbol: 'BTCUSDT', timeSec: Date.UTC(2026, 10, 4, 3) / 1000 },
  chart: {
    kind: 'bars_mirror', unit: 'usd', ref: 0, band: null, marks: [],
    series: [
      { key: 'short', points: [0, 1, 2, 3].map((i) => ({ time: T0 + i * 60, value: 1_000 })) },
      { key: 'long', points: [0, 1, 2, 3].map((i) => ({ time: T0 + i * 60, value: i === 2 ? 9_000_000 : 50_000 })) },
    ],
    highlight: { from: T0 + 120, to: T0 + 120 }, span: { from: T0, to: T0 + 180 },
  },
};

function render(s: WebInsightStatement, lang: 'ru' | 'en') {
  TestBed.configureTestingModule({ imports: [InsightCardComponent], providers: [provideRouter([])] });
  TestBed.inject(I18nService).setLang(lang);
  const f = TestBed.createComponent(InsightCardComponent);
  f.componentRef.setInput('statement', s);
  f.componentRef.setInput('nowSec', NOW);
  f.detectChanges();
  return f.nativeElement as HTMLElement;
}

describe('InsightCardComponent (IB-107)', () => {
  it('draws chip, when, title with its figures in .num, the chart with its lit bars, the link and the quiet basis', () => {
    const el = render(r3, 'ru');
    const text = (sel: string) => el.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim();
    expect(el.querySelector('.card')?.classList).toContain('tone-long');
    expect(text('.chip')).toBe('Ликвидации');
    expect(text('.when')).toBe(`сегодня ${AT3}`);
    expect(text('.title')).toBe('Каскад ликвидаций лонгов за 9 мин: 21, всего $14M');
    expect([...el.querySelectorAll('.title .num')].map((n) => n.textContent)).toEqual(['21', '$14M']);
    const bars = [...el.querySelectorAll('app-insight-chart .bar')];
    expect(bars).toHaveLength(8); // two sides × four minutes
    expect(bars.map((b) => b.classList.contains('lit'))).toEqual([false, false, true, false, false, false, true, false]);
    // the side the card names (longs) in colour, the other muted
    expect(bars.slice(4).every((b) => b.classList.contains('named'))).toBe(true);
    expect(bars.slice(0, 4).every((b) => b.classList.contains('other'))).toBe(true);
    expect(el.querySelector('.card')?.classList).toContain('has-chart');
    expect(text('.link')).toBe(`Открыть BTC в ${AT3} →`);
    expect(el.querySelector('.link')?.getAttribute('href')).toBe('/instrument/BTCUSDT?at=' + Date.UTC(2026, 10, 4, 3) / 1000);
    expect(text('.basis')).toBe('за 24ч · Binance, Bybit, OKX');
    expect(el.querySelector('.basis')?.getAttribute('title')).toBe(`норма: 690 окон с данными из 697, с ${dayMonth(Date.UTC(2026, 9, 5) / 1000)}`);
  });

  it('figures sit in the title with no added spaces: «… 52 (+6.1)»', () => {
    const r8: WebInsightStatement = { ...r3, ruleId: 'R8', block: 'flows', key: 'insight.dvol_spike', params: { value: 52.2, change: 6.1 }, link: { anchor: 'flows' }, chart: null };
    const el = render(r8, 'ru');
    expect(el.querySelector('.title')?.textContent).toBe('Опционы BTC подорожали: ожидаемая волатильность 52 (+6.1)');
  });

  it('a percentage in the title: digits in .num, « %» outside it in the text face (TL 2026-11-04)', () => {
    const r4: WebInsightStatement = { ...r3, ruleId: 'R4', block: 'positioning', key: 'insight.oi_vs_price', params: { symbol: 'BNBUSDT', quadrant: 'short_closing', oiPct: -5.1, pricePct: 2.5 }, link: { route: 'instrument', symbol: 'BNBUSDT', timeSec: NOW - 86_400 }, chart: null };
    const title = render(r4, 'ru').querySelector('.title') as HTMLElement;
    expect([...title.querySelectorAll('.num')].map((n) => n.textContent)).toEqual(['−5.1', '+2.5']);
    expect(title.textContent).toBe('BNB: открытый интерес −5.1 % при цене +2.5 %');
    expect([...title.querySelectorAll('.num')].some((n) => n.textContent?.includes('%'))).toBe(false);
  });

  it('IB-BUG-035: a block link is the current page with the block as its fragment, never a bare #href', () => {
    const r8: WebInsightStatement = { ...r3, ruleId: 'R8', block: 'flows', key: 'insight.dvol_spike', params: { value: 52.2, change: 6.1 }, link: { anchor: 'flows' }, chart: null };
    const href = render(r8, 'ru').querySelector('.link')?.getAttribute('href');
    expect(href).toBe('/#flows'); // the test host sits at '/'; on the page it is /market?p=…#flows
    expect(href).toMatch(/^\//);
  });

  it('no chart: one column, the rest stands', () => {
    const el = render({ ...r3, chart: null }, 'en');
    expect(el.querySelector('app-insight-chart')).toBeNull();
    expect(el.querySelector('.card')?.classList).not.toContain('has-chart');
    expect(el.querySelector('.title')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Cascade of long liquidations in 9 min: 21, $14M in total');
  });
});

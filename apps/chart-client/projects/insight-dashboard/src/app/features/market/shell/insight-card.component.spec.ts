import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { WebInsightStatement } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import { I18nService } from '../../../i18n/i18n.service';
import { InsightCardComponent } from './insight-card.component';

/** IB-107 — the card as the page draws it: chip, words, figures in the number face, one bar per value. */
const NOW = Date.UTC(2026, 10, 4, 14) / 1000;
const r3: WebInsightStatement = {
  ruleId: 'R3', block: 'liquidations', key: 'insight.liq_cascade', params: { side: 'long', count: 21, minutes: 9, usd: 14_400_000, symbol: 'BTCUSDT' },
  rarity: 0.97, magnitude: 14_400_000, basis: { window: '24h', venues: ['binance', 'bybit', 'okx'], sampleWindows: 697, observedWindows: 690, from: Date.UTC(2026, 9, 5) / 1000 },
  link: { route: 'instrument', symbol: 'BTCUSDT', timeSec: Date.UTC(2026, 10, 4, 3) / 1000 },
  spark: { values: [1, 2, 9, 3], highlight: 2 },
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
  it('draws chip, when, title with its figures in .num, the spark with the lit bar, the link and the quiet basis', () => {
    const el = render(r3, 'ru');
    const text = (sel: string) => el.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim();
    expect(el.querySelector('.card')?.classList).toContain('tone-long');
    expect(text('.chip')).toBe('Ликвидации');
    expect(text('.when')).toBe('сегодня 03:00 UTC');
    expect(text('.title')).toBe('Каскад: 21 ликвидаций лонгов за 9 мин, всего $14M');
    expect([...el.querySelectorAll('.title .num')].map((n) => n.textContent)).toEqual(['21', '$14M']);
    const bars = [...el.querySelectorAll('.spark .bar')];
    expect(bars).toHaveLength(4);
    expect(bars.map((b) => b.classList.contains('lit'))).toEqual([false, false, true, false]);
    expect(el.querySelector('.spark')?.getAttribute('aria-hidden')).toBe('true');
    expect(text('.link')).toBe('Открыть BTC в 03:00 UTC →');
    expect(el.querySelector('.link')?.getAttribute('href')).toBe('/instrument/BTCUSDT?at=' + Date.UTC(2026, 10, 4, 3) / 1000);
    expect(text('.basis')).toBe('за 24ч · Binance, Bybit, OKX');
    expect(el.querySelector('.basis')?.getAttribute('title')).toBe('норма: 690 окон с данными из 697, с 2026-10-05');
  });

  it('no spark: no chart, the rest stands', () => {
    const el = render({ ...r3, spark: null }, 'en');
    expect(el.querySelector('.spark')).toBeNull();
    expect(el.querySelector('.title')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Cascade: 21 long liquidations in 9 min, $14M in total');
  });
});

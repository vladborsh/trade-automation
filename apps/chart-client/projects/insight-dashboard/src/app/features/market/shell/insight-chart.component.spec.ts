import { TestBed } from '@angular/core/testing';
import type { WebInsightChart, WebInsightStatement } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import { I18nService } from '../../../i18n/i18n.service';
import { InsightChartComponent } from './insight-chart.component';

/**
 * IB-119 — the chart as the card draws it (mockup §1–2): caption, the value in the corner, the axis
 * labels in the unit, the span named, a one-line legend; R5's bars amber outside the band, muted inside.
 */
const NOW = Date.UTC(2026, 10, 5, 12) / 1000;
const S8 = 8 * 3_600;
const basis = { window: '24h' as const, venues: ['binance'], sampleWindows: 90, observedWindows: 90, from: null };
const r5: WebInsightStatement = {
  ruleId: 'R5', block: 'positioning', key: 'insight.funding_extremes', params: { count: 3, total: 30, symbol: 'TRUMPUSDT', rate: -0.000332 },
  rarity: 0.99, magnitude: 3, basis, link: { anchor: 'positioning' }, chart: null,
};
const funding: WebInsightChart = {
  kind: 'bars', unit: 'pct', ref: 0, band: { lo: -0.004, hi: 0.014 }, marks: [],
  series: [{ key: 'funding', points: [...Array.from({ length: 90 }, (_, i) => ({ time: NOW - (90 - i) * S8, value: i < 80 ? 0.006 : -0.02 })), { time: NOW, value: -0.0332 }] }],
  highlight: { from: NOW, to: NOW }, span: { from: NOW - 90 * S8, to: NOW },
};
const r4: WebInsightStatement = {
  ...r5, ruleId: 'R4', key: 'insight.oi_vs_price', params: { symbol: 'BNBUSDT', quadrant: 'short_closing', oiPct: -4.1, pricePct: 1.8 },
  link: { route: 'instrument', symbol: 'BNBUSDT', timeSec: NOW - 86_400 },
};
const lines: WebInsightChart = {
  kind: 'lines', unit: 'pct', ref: 0, band: null, marks: [], highlight: null, span: { from: NOW - 86_400, to: NOW },
  series: [
    { key: 'price', points: [{ time: NOW - 86_400, value: 0 }, { time: NOW, value: 1.8 }] },
    { key: 'oi', points: [{ time: NOW - 86_400, value: 0 }, { time: NOW, value: -4.1 }] },
  ],
};

function render(statement: WebInsightStatement, chart: WebInsightChart, lang: 'ru' | 'en' = 'ru') {
  TestBed.configureTestingModule({ imports: [InsightChartComponent] });
  TestBed.inject(I18nService).setLang(lang);
  const f = TestBed.createComponent(InsightChartComponent);
  f.componentRef.setInput('statement', statement);
  f.componentRef.setInput('chart', chart);
  f.componentRef.setInput('nowSec', NOW);
  f.detectChanges();
  return f.nativeElement as HTMLElement;
}
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();
const all = (el: HTMLElement, sel: string) => [...el.querySelectorAll(sel)].map((n) => text(n));

describe('InsightChartComponent (IB-119)', () => {
  it('R5: the mockup\'s caption, «сейчас −0.0332 %», a y axis in %, «−30д … сейчас», band / 0 / now in the legend', () => {
    const el = render(r5, funding);
    expect(text(el.querySelector('.caption'))).toBe('Фандинг TRUMP, 30 дней (каждая выплата)');
    expect(text(el.querySelector('.corner .prefix'))).toBe('сейчас');
    expect(all(el, '.corner .num')).toEqual(['−0.0332 %']);
    expect(all(el, '.yaxis .num')).toEqual(['+0.02%', '0.00%', '−0.02%', '−0.04%']);
    expect(all(el, '.xaxis .x')).toEqual(['−30д', '−15д', 'сейчас']);
    expect(all(el, '.legend .key')).toEqual(['обычный диапазон (90 % выплат)', '0', 'сейчас']);
    expect(el.querySelector('figure')?.getAttribute('role')).toBe('img');
    expect(el.querySelector('figure')?.getAttribute('aria-label')).toBe('Фандинг TRUMP, 30 дней (каждая выплата) — сейчас −0.0332 %');
  });

  it('R5: bars outside the band amber (.out), inside muted (.in); the last one lit with the now dot', () => {
    const el = render(r5, funding);
    const bars = [...el.querySelectorAll('.bar')];
    expect(bars).toHaveLength(91);
    expect(bars.slice(0, 80).every((b) => b.classList.contains('in'))).toBe(true);
    expect(bars.slice(80).every((b) => b.classList.contains('out'))).toBe(true);
    expect(bars.map((b) => b.classList.contains('lit')).lastIndexOf(true)).toBe(90);
    expect(el.querySelector('.dot.now.out')).not.toBeNull();
    expect(el.querySelector('.band')).not.toBeNull();
  });

  it('R4: «цена +1.8 % · OI −4.1 %» in the corner, two lines, the legend says what 0 means', () => {
    const el = render(r4, lines);
    expect(all(el, '.corner .val .name')).toEqual(['цена', 'OI']);
    expect(all(el, '.corner .num')).toEqual(['+1.8 %', '−4.1 %']); // only the number in the mono face
    expect(text(el.querySelector('.caption'))).toBe('BNB за 24ч, изменение от начала, %');
    expect(el.querySelectorAll('path.line')).toHaveLength(2);
    expect(all(el, '.legend .key')).toEqual(['цена', 'открытый интерес', '0 % — начало периода']);
    expect(all(el, '.xaxis .x')).toEqual(['−24ч', '−12ч', 'сейчас']);
  });

  it('English: the same chart, worded in English; no label says what comes next (D20)', () => {
    const el = render(r4, lines, 'en');
    expect(text(el.querySelector('.caption'))).toBe('BNB over 24h, change from the start, %');
    expect(all(el, '.xaxis .x')).toEqual(['−24h', '−12h', 'now']);
    expect(text(el)).not.toMatch(/will|expect|forecast|прогноз|будет/i);
  });
});

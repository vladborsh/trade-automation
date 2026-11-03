import { TestBed } from '@angular/core/testing';
import type { WebFearGreedCard, WebFearGreedReading } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import { I18nService } from '../../i18n/i18n.service';
import { FearGreedGaugeComponent } from './fear-greed-gauge.component';

/** IB-102 — the gauge as the page renders it. */
const day = (i: number) => new Date(Date.UTC(2026, 9, 28) + i * 86_400_000).toISOString().slice(0, 10);
const readings = (n: number, value = 40): WebFearGreedReading[] =>
  Array.from({ length: n }, (_, i) => ({ day: day(i), value: value + i, classification: 'Fear' }));

function card(value: number, history: WebFearGreedReading[] | undefined): WebFearGreedCard {
  const now = { day: '2026-11-03', value, classification: 'Neutral' };
  return { now, previous: null, weekAgo: null, history: history as WebFearGreedReading[], source: 'alternative.me' };
}

function render(c: WebFearGreedCard, lang: 'en' | 'ru' = 'en') {
  TestBed.configureTestingModule({ imports: [FearGreedGaugeComponent] });
  TestBed.inject(I18nService).setLang(lang);
  const f = TestBed.createComponent(FearGreedGaugeComponent);
  f.componentRef.setInput('card', c);
  f.detectChanges();
  return f.nativeElement as HTMLElement;
}

describe('FearGreedGaugeComponent (IB-102)', () => {
  it('draws five zone arcs and a needle, the number, its zone word, the source\'s word and the attribution', () => {
    const el = render(card(55, readings(7)));
    expect(el.querySelectorAll('svg.gauge path.arc')).toHaveLength(5);
    expect(el.querySelector('svg.gauge line.needle')).not.toBeNull();
    expect(el.querySelector('.value')?.textContent?.trim()).toBe('55');
    // 55 is NEUTRAL, as the bot says (the old client table called it greed)
    expect(el.querySelector('.label')?.textContent?.trim()).toBe('neutral');
    expect(el.textContent).toContain('Neutral'); // the source's own classification, verbatim
    expect(el.textContent).toContain('source: alternative.me');
  });

  it('draws the 30-day line from 7 published days, with zone bands behind it', () => {
    const el = render(card(46, readings(7)));
    expect(el.querySelector('svg.line polyline.history')?.getAttribute('points')?.split(' ')).toHaveLength(7);
    expect(el.querySelectorAll('svg.line rect.zone')).toHaveLength(5);
  });

  it.each([
    ['6 days', readings(6)],
    ['no history (a server from before IB-102)', undefined],
  ])('no line and no empty frame with %s', (_label, history) => {
    const el = render(card(46, history));
    expect(el.querySelector('svg.line')).toBeNull();
    expect(el.textContent).not.toContain('last 30 days');
    expect(el.querySelector('svg.gauge')).not.toBeNull(); // the gauge itself still shows
  });

  it('marks «a week ago» only when that day was published', () => {
    expect(render(card(47, readings(8))).querySelector('svg.line line.week-mark')).not.toBeNull();
    TestBed.resetTestingModule();
    const missing = readings(8).filter((r) => r.day !== day(0)); // newest is day(7); a week before is day(0)
    expect(render(card(47, missing)).querySelector('svg.line line.week-mark')).toBeNull();
  });

  it('speaks Russian on a Russian page', () => {
    const el = render(card(20, readings(7)), 'ru');
    expect(el.querySelector('.label')?.textContent?.trim()).toBe('крайний страх');
    expect(el.textContent).toContain('за 30 дней');
  });
});

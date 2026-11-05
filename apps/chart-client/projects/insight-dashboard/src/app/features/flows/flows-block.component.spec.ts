import { TestBed } from '@angular/core/testing';
import type { WebFlowsResponse } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import example from '../../../../../../../../libs/contracts/test/fixtures/flows.24h.json';
import { I18nService } from '../../i18n/i18n.service';
import { FlowsBlockComponent } from './flows-block.component';

/** IB-091 — the block as the page renders it, from the contract's real example. */
const base = example as unknown as WebFlowsResponse;

function render(flows: WebFlowsResponse, lang: 'ru' | 'en' = 'ru') {
  TestBed.configureTestingModule({ imports: [FlowsBlockComponent] });
  TestBed.inject(I18nService).setLang(lang);
  const f = TestBed.createComponent(FlowsBlockComponent);
  f.componentRef.setInput('flows', flows);
  f.componentRef.setInput('period', '24h');
  f.detectChanges();
  return f.nativeElement as HTMLElement;
}
const tile = (el: HTMLElement, id: string) => el.querySelector(`[data-tile="${id}"]`) as HTMLElement;

describe('FlowsBlockComponent (IB-091)', () => {
  it('four tiles with their figures, the premium explained as D18, and every source credited', () => {
    const el = render(base);
    expect(el.querySelectorAll('article.tile')).toHaveLength(4);
    expect(tile(el, 'dvol').querySelector('.value')?.textContent).toContain('39.7');
    expect(tile(el, 'dvol').querySelector('.detail')?.textContent?.trim()).toBe('+1.1 пт за 24ч');
    expect(tile(el, 'coinbasePremium').querySelector('.note')?.textContent?.trim()).toBe('к доллару, с поправкой на USDT');
    expect(el.querySelector('.source')?.textContent?.trim()).toBe('Данные: Deribit · OKX · DefiLlama · Coinbase');
  });

  it('D18 in words: too few complete minutes is SAID, the value kept, no sign colour', () => {
    const el = render({ ...base, coinbasePremium: { ...base.coinbasePremium, unavailable: 'insufficient_minutes', minutes: 44 } });
    const p = tile(el, 'coinbasePremium');
    expect(p.querySelector('.warn')?.textContent?.trim()).toBe('мало полных минут за час (44 из 60) — знак не называем');
    expect(p.querySelector('.value')?.classList.contains('down')).toBe(false);
  });

  it('a source that did not answer: no figure, the reason instead', () => {
    const el = render({ ...base, putCall: { ...base.putCall, oiRatio: null, volumeRatio: null, unavailable: 'source_unavailable' } }, 'en');
    expect(tile(el, 'putCall').querySelector('.value')).toBeNull();
    expect(tile(el, 'putCall').querySelector('.warn')?.textContent?.trim()).toBe('the source did not answer');
  });

  it('IB-138: the help is one collapsed line at the top of the card, above the tiles', () => {
    const el = render(base);
    const help = el.querySelector('app-flows-help') as HTMLElement;
    expect(help.querySelector('details')?.open).toBe(false);
    expect(help.querySelector('summary')?.textContent?.trim()).toBe('Как читать эти показатели?');
    expect(help.compareDocumentPosition(el.querySelector('.tiles') as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

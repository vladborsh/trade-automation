import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { WebInsightBlockLine } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import { I18nService } from '../../../i18n/i18n.service';
import { BlockConclusionComponent } from './block-conclusion.component';

/** IB-BUG-028 — the block line as the page renders it when the rules could not look. */
function render(line: WebInsightBlockLine, lang: 'ru' | 'en') {
  TestBed.configureTestingModule({ imports: [BlockConclusionComponent], providers: [provideRouter([])] });
  TestBed.inject(I18nService).setLang(lang);
  const f = TestBed.createComponent(BlockConclusionComponent);
  f.componentRef.setInput('line', line);
  f.componentRef.setInput('period', '24h');
  f.detectChanges();
  return (f.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

describe('BlockConclusionComponent (IB-BUG-028)', () => {
  it('names the sources that did not answer — and does not say «nothing unusual»', () => {
    const down: WebInsightBlockLine = { block: 'flows', statement: null, neutral: { key: 'insight.neutral', reason: 'source_unavailable', basis: null, sources: ['deribit', 'defillama', 'coinbase', 'binance'] } };
    const ru = render(down, 'ru');
    // the block's sources, not a claim that each one failed: the engine knows only that no data came
    expect(ru).toContain('Не смогли проверить: данные не пришли (источники: Deribit, DefiLlama, Coinbase, Binance)');
    expect(ru).not.toContain('Ничего необычного');
    TestBed.resetTestingModule();
    const tape: WebInsightBlockLine = { block: 'liquidations', statement: null, neutral: { key: 'insight.neutral', reason: 'source_unavailable', basis: null, sources: ['tape'] } };
    expect(render(tape, 'en')).toContain('Could not check: no data arrived (sources: our liquidation tape)');
  });
});

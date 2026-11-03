import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { WebLiquidationBlock, WebLiquidationCoinPeriod, WebMarketPeriod } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import blockFixture from '../../../../../../../../libs/contracts/test/fixtures/liquidation-block.24h.json';
import { I18nService } from '../../i18n/i18n.service';
import { LiqWhereComponent } from './liq-where.component';

/**
 * IB-101 — the folded where-block as the page renders it: 8 rows and «3 more coins · $X» for 11
 * coins, every row after «Show all», folded again by a new period, never folded for 10 coins, and the
 * quiet-coins line visible while folded. Unfolding is not stored anywhere: a fresh component is folded.
 */
const block = blockFixture as unknown as WebLiquidationBlock;

function coins(n: number, quiet = 0): WebLiquidationCoinPeriod[] {
  const base = block.perCoin[0];
  const active = Array.from({ length: n }, (_, i) => {
    const usd = (n - i) * 1_000_000;
    return { ...base, symbol: `C${i}USDT`, base: `C${i}`, totals: { ...base.totals, usd, long: usd / 2, short: usd / 2 } };
  });
  const silent = Array.from({ length: quiet }, (_, i) => ({ ...base, symbol: `Q${i}USDT`, base: `Q${i}`, verdict: null, totals: { ...base.totals, usd: 0, long: 0, short: 0 } }));
  return [...active, ...silent];
}

function render(perCoin: WebLiquidationCoinPeriod[], period: WebMarketPeriod = '24h') {
  TestBed.configureTestingModule({ imports: [LiqWhereComponent], providers: [provideRouter([])] });
  TestBed.inject(I18nService).setLang('en');
  const f = TestBed.createComponent(LiqWhereComponent);
  f.componentRef.setInput('perCoin', perCoin);
  f.componentRef.setInput('period', period);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const rows = () => el.querySelectorAll('li.row').length;
  const button = () => el.querySelector<HTMLButtonElement>('button.fold-toggle');
  return { f, el, rows, button };
}

describe('LiqWhereComponent — folded to the top 8 (IB-101)', () => {
  it('11 coins: 8 rows, «3 more coins · $6M» (the hidden ones: 3+2+1 M) and «Show all (3)»', () => {
    const { el, rows, button } = render(coins(11));
    expect(rows()).toBe(8);
    expect(el.textContent).toContain('3 more coins · $6M');
    expect(button()?.textContent?.trim()).toBe('Show all (3)');
    expect(button()?.getAttribute('aria-expanded')).toBe('false');
  });

  it('«Show all» draws every row, and «Show fewer» folds again', () => {
    const { f, el, rows, button } = render(coins(11));
    button()!.click();
    f.detectChanges();
    expect(rows()).toBe(11);
    expect(el.textContent).not.toContain('more coins');
    expect(button()?.textContent?.trim()).toBe('Show fewer');
    button()!.click();
    f.detectChanges();
    expect(rows()).toBe(8);
  });

  it('a new period folds the block again', () => {
    const { f, rows, button } = render(coins(11), '24h');
    button()!.click();
    f.detectChanges();
    expect(rows()).toBe(11);
    f.componentRef.setInput('period', '7d');
    f.detectChanges();
    expect(rows()).toBe(8);
  });

  it('10 coins: everything shown and no button — never a button that hides two rows', () => {
    const { el, rows, button } = render(coins(10));
    expect(rows()).toBe(10);
    expect(button()).toBeNull();
    expect(el.textContent).not.toContain('more coins');
  });

  it('the quiet-coins line stays visible while folded', () => {
    const { el, rows } = render(coins(11, 4));
    expect(rows()).toBe(8);
    expect(el.textContent).toContain('Coins with nothing in this period: 4');
  });
});

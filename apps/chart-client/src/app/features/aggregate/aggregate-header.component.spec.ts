import { TestBed } from '@angular/core/testing';
import type { MetricAggregate } from '@trade-automation/contracts';
import { AggregateHeaderComponent } from './aggregate-header.component';
import { ALL, BN, BY, aggPoint } from './aggregate-test-points';

const definition: MetricAggregate = {
  id: 'btc-perp-oi',
  displayName: 'BTC perps · 3 venues',
  metric: 'openInterest',
  countingConvention: 'one-sided',
  members: [
    { id: 'binance:BTCUSDT', venue: 'binance', symbol: 'BTCUSDT', quoteCurrency: 'USDT' },
    { id: 'bybit:BTCUSDT', venue: 'bybit', symbol: 'BTCUSDT', quoteCurrency: 'USDT' },
    { id: 'hyperliquid:BTC', venue: 'hyperliquid', symbol: 'BTC', quoteCurrency: 'USDC' },
  ],
};

describe('AggregateHeaderComponent (aggregate-oi.md §1 points 3–4)', () => {
  function render(point = aggPoint(0, ALL), aggregate: MetricAggregate | null = definition): HTMLElement {
    const fixture = TestBed.createComponent(AggregateHeaderComponent);
    fixture.componentRef.setInput('aggregate', aggregate);
    fixture.componentRef.setInput('point', point);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('complete bar: full chip, not muted; one-sided badge with a tooltip', () => {
    const el = render();
    const chip = el.querySelector('[data-testid="coverage-chip"]')!;
    expect(chip.textContent).toBe('3/3 · Binance · Bybit · Hyperliquid');
    expect(chip.classList.contains('partial')).toBe(false);
    const badge = el.querySelector('[data-testid="convention-badge"]')!;
    expect(badge.textContent).toBe('one-sided');
    expect(badge.getAttribute('title')).toContain('16 %');
  });

  it('partial bar: muted chip naming the missing venue, tooltip per venue', () => {
    const chip = render(aggPoint(0, [BN, BY])).querySelector('[data-testid="coverage-chip"]')!;
    expect(chip.textContent).toBe('2/3 · Binance · Bybit — без Hyperliquid');
    expect(chip.classList.contains('partial')).toBe(true);
    expect(chip.getAttribute('title')).toContain('Hyperliquid: нет в этой свече');
  });

  it("as-published reads 'as published'", () => {
    const el = render(aggPoint(0, ALL), { ...definition, countingConvention: 'as-published' });
    expect(el.querySelector('[data-testid="convention-badge"]')!.textContent).toBe('as published');
  });
});

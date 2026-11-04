import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import { InstrumentContextComponent } from './instrument-context.component';
import { nowTiles } from './instrument-now';

const emptyNow = nowTiles(null, null, 'TRXUSDT');

/** IB-110 — a coin outside the collected universe (TRX, on the alert list only) says its liquidations are not collected. */
function render(symbol: string, collected: Array<{ id: string }>) {
  TestBed.configureTestingModule({
    imports: [InstrumentContextComponent],
    providers: [provideRouter([]), { provide: InsightApiClient, useValue: { marketCards: async () => { throw new Error('offline'); } } }],
  });
  TestBed.inject(I18nService).setLang('en');
  const f = TestBed.createComponent(InstrumentContextComponent);
  f.componentRef.setInput('symbol', symbol);
  f.componentRef.setInput('now', emptyNow);
  f.componentRef.setInput('collected', collected);
  f.detectChanges();
  return f.nativeElement as HTMLElement;
}

describe('InstrumentContextComponent — liquidations not collected (IB-110)', () => {
  const universe = [{ id: 'BTCUSDT' }, { id: 'ETHUSDT' }];

  it('a coin outside the universe: the block says it, by the coin’s base', () => {
    const el = render('TRXUSDT', universe);
    expect(el.querySelector('.not-collected')?.textContent).toContain('We do not collect liquidations for TRX');
    TestBed.resetTestingModule();
  });

  it('a universe coin says nothing of the kind; nor does any coin before the list has loaded (empty)', () => {
    expect(render('BTCUSDT', universe).querySelector('.not-collected')).toBeNull();
    TestBed.resetTestingModule();
    expect(render('TRXUSDT', []).querySelector('.not-collected')).toBeNull();
    TestBed.resetTestingModule();
  });
});

import { TestBed } from '@angular/core/testing';
import { LIQ_DEFAULT_PARAMS, type WebLiqAlertSettingsPatch, type WebLiqAlertsAdminResponse } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import { AdminLiqAlertsComponent } from './admin-liq-alerts.component';

/** IB-122 (liq design §1, L4) — the «Large liquidations» section against a stub API: what it shows and sends. */
const PAGE: WebLiqAlertsAdminResponse = {
  settings: { enabled: false, membersVisible: false, params: LIQ_DEFAULT_PARAMS, updatedAt: Date.UTC(2026, 10, 5) / 1000 },
  coins: [
    { symbol: 'BTCUSDT', base: 'BTC', listed: true, enabled: true, thresholdUsd: 5e6 },
    { symbol: 'DOGEUSDT', base: 'DOGE', listed: false, enabled: false, thresholdUsd: null },
  ],
  alerts: [{ id: 3, source: 'live', event: 'alert', symbol: 'BTCUSDT', side: 'long', at: Date.UTC(2026, 10, 5, 14, 7) / 1000, sumUsd: 7.4e6, thresholdUsd: 5e6, coins: ['BTCUSDT'], news: true, firedAt: null, late: false, recipients: 0, mutedBy: null }],
};

async function setup() {
  const sent: WebLiqAlertSettingsPatch[] = [];
  TestBed.configureTestingModule({
    imports: [AdminLiqAlertsComponent],
    providers: [{
      provide: InsightApiClient,
      useValue: {
        liqAlertsAdmin: async () => PAGE,
        patchLiqAlerts: async (p: WebLiqAlertSettingsPatch) => {
          sent.push(p);
          const coins = PAGE.coins.map((c) => (p.perCoin?.[c.symbol] ? { ...c, ...p.perCoin[c.symbol] } : c));
          return { ...PAGE, coins, settings: { ...PAGE.settings, enabled: p.enabled ?? PAGE.settings.enabled } };
        },
      },
    }],
  });
  TestBed.inject(I18nService).setLang('en');
  const fixture = TestBed.createComponent(AdminLiqAlertsComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance, sent, el: fixture.nativeElement as HTMLElement };
}

describe('AdminLiqAlertsComponent (IB-122)', () => {
  it('shows sending OFF, each coin\'s threshold (none = off), and the journal row with the bot\'s money', async () => {
    const { el } = await setup();
    expect(el.querySelector('h2')?.textContent).toContain('Large liquidations');
    expect(el.querySelector('.switch strong')?.textContent).toContain('off');
    const inputs = [...el.querySelectorAll<HTMLInputElement>('input[inputmode="numeric"]')].map((i) => i.value);
    expect(inputs).toEqual(['5000000', '']);
    expect(el.textContent).toContain('paused in the list above');
    const journal = [...el.querySelectorAll('tbody')].at(-1)?.textContent ?? '';
    expect(journal).toContain('$7.4M');
    expect(journal).toContain('longs');
    expect(journal).toContain('journal only');
  });

  it('sends only the changed coin; a coin switched on without a threshold cannot be saved', async () => {
    const { cmp, sent, fixture } = await setup();
    expect(cmp.changed()).toBe(false);
    cmp.edit('DOGEUSDT', 'enabled', true);
    expect(cmp.patch()).toBeNull();
    cmp.edit('DOGEUSDT', 'threshold', '200 000');
    fixture.detectChanges();
    await cmp.save();
    expect(sent).toEqual([{ perCoin: { DOGEUSDT: { enabled: true, thresholdUsd: 2e5 } } }]);
  });

  it('the sending switch sends just that field', async () => {
    const { cmp, sent } = await setup();
    await cmp.setSwitch('enabled', true);
    expect(sent).toEqual([{ enabled: true }]);
    expect(cmp.page()?.settings.enabled).toBe(true);
  });
});

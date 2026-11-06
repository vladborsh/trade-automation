import { TestBed } from '@angular/core/testing';
import { FUNDING_DEFAULT_PARAMS, type WebFundingAlertSettingsPatch, type WebFundingAlertsAdminResponse } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import { AdminFundingAlertsComponent } from './admin-funding-alerts.component';

/** IB-124 (design §1, F3, F5) — the «Funding» section against a stub API: what it shows and sends. */
const PAGE: WebFundingAlertsAdminResponse = {
  settings: { enabled: false, membersVisible: false, params: FUNDING_DEFAULT_PARAMS, updatedAt: Date.UTC(2026, 10, 6) / 1000 },
  defaultFloorPer8h: 0.0003,
  coins: [
    { symbol: 'BTCUSDT', base: 'BTC', listed: true, enabled: true, floorPer8h: null },
    { symbol: 'TRXUSDT', base: 'TRX', listed: false, enabled: true, floorPer8h: 0.0005 },
  ],
  alerts: [{ id: 3, source: 'live', event: 'enter', symbol: 'BTCUSDT', side: 'high', at: Date.UTC(2026, 10, 6, 1, 5) / 1000, rate: 0.0002, intervalH: 4, ratePer8h: 0.0004, episodeHours: null, firedAt: null, late: false, recipients: 0 }],
};

async function setup() {
  const sent: WebFundingAlertSettingsPatch[] = [];
  TestBed.configureTestingModule({
    imports: [AdminFundingAlertsComponent],
    providers: [{
      provide: InsightApiClient,
      useValue: {
        fundingAlertsAdmin: async () => PAGE,
        patchFundingAlerts: async (p: WebFundingAlertSettingsPatch) => {
          sent.push(p);
          return { ...PAGE, settings: { ...PAGE.settings, enabled: p.enabled ?? PAGE.settings.enabled } };
        },
      },
    }],
  });
  TestBed.inject(I18nService).setLang('en');
  const fixture = TestBed.createComponent(AdminFundingAlertsComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance, sent, el: fixture.nativeElement as HTMLElement };
}

describe('AdminFundingAlertsComponent (IB-124)', () => {
  it('shows sending OFF, the shared floor as the placeholder, a coin\'s own floor, the bounds and the journal row', async () => {
    const { el } = await setup();
    expect(el.querySelector('h2')?.textContent).toContain('Funding');
    expect(el.querySelector('.switch strong')?.textContent).toContain('off');
    const floors = [...el.querySelectorAll<HTMLInputElement>('tbody input[inputmode="decimal"]')];
    expect(floors.map((i) => [i.value, i.placeholder])).toEqual([['', '0.03'], ['0.05', '0.03']]);
    expect(el.textContent).toContain('the shared floor ±0.03%');
    expect(el.querySelector<HTMLInputElement>('[data-testid="funding-min-episode"]')?.value).toBe('24');
    expect(el.querySelector<HTMLInputElement>('[data-testid="funding-flip-within"]')?.value).toBe('72');
    const journal = [...el.querySelectorAll('tbody')].at(-1)?.textContent ?? '';
    expect(journal).toContain('+0.0200% / 4h');
    expect(journal).toContain('longs pay');
    expect(journal).toContain('journal only');
  });

  it('sends only what changed: one coin\'s floor and one bound; a bad value cannot be saved', async () => {
    const { cmp, sent } = await setup();
    expect(cmp.changed()).toBe(false);
    cmp.edit('BTCUSDT', 'floor', '0.04');
    cmp.minEpisode.set('12');
    await cmp.save();
    expect(sent).toEqual([{ perCoin: { BTCUSDT: { enabled: true, floorPer8h: 0.0004 } }, minEpisodeHours: 12 }]);
    cmp.flipWithin.set('0');
    expect(cmp.patch()).toBeNull();
  });

  it('the sending switch sends just that field', async () => {
    const { cmp, sent } = await setup();
    await cmp.setSwitch('enabled', true);
    expect(sent).toEqual([{ enabled: true }]);
    expect(cmp.page()?.settings.enabled).toBe(true);
  });
});

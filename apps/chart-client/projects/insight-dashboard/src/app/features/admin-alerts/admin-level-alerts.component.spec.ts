import { TestBed } from '@angular/core/testing';
import { LEVEL_DEFAULT_PARAMS, type WebLevelAlertSettingsPatch, type WebLevelAlertsAdminResponse } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import { AdminLevelAlertsComponent } from './admin-level-alerts.component';
import { eventGrid } from './level-rows';

/** IB-126 (design §1, P2) — the «Levels» section against a stub API: what it shows and sends. */
const EVENTS = Object.fromEntries(eventGrid({ PWH: { crossunder: false } }).map((r) => [r.kind, Object.fromEntries(r.cells.filter((c) => c).map((c) => [c!.event, c!.on]))]));
const PAGE: WebLevelAlertsAdminResponse = {
  settings: { enabled: false, membersVisible: false, params: { ...LEVEL_DEFAULT_PARAMS, events: { PWH: { crossunder: false } } }, updatedAt: Date.UTC(2026, 10, 6) / 1000 },
  events: EVENTS,
  coins: [
    { symbol: 'BTCUSDT', base: 'BTC', listed: true, enabled: true, daily: false, stateRows: 4 },
    { symbol: 'TRXUSDT', base: 'TRX', listed: false, enabled: true, daily: true, stateRows: 0 },
  ],
  alerts: [{ id: 3, source: 'live', event: 'breakout_up', symbol: 'BTCUSDT', kind: 'PWH', price: 71850, at: Date.UTC(2026, 10, 6, 1, 0) / 1000, close: 72140, firedAt: null, late: true, recipients: 0 }],
};

async function setup() {
  const sent: WebLevelAlertSettingsPatch[] = [];
  TestBed.configureTestingModule({
    imports: [AdminLevelAlertsComponent],
    providers: [{
      provide: InsightApiClient,
      useValue: {
        levelAlertsAdmin: async () => PAGE,
        patchLevelAlerts: async (p: WebLevelAlertSettingsPatch) => {
          sent.push(p);
          return { ...PAGE, settings: { ...PAGE.settings, enabled: p.enabled ?? PAGE.settings.enabled } };
        },
      },
    }],
  });
  TestBed.inject(I18nService).setLang('en');
  const fixture = TestBed.createComponent(AdminLevelAlertsComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance, sent, el: fixture.nativeElement as HTMLElement };
}

describe('AdminLevelAlertsComponent (IB-126)', () => {
  it('shows sending OFF, the event grid with a dash where an event does not apply, the coins with PDH/PDL and seed state, the journal', async () => {
    const { el } = await setup();
    expect(el.querySelector('h2')?.textContent).toContain('Levels');
    expect(el.querySelector('.switch strong')?.textContent).toContain('off');
    const rows = [...el.querySelectorAll('table.grid tbody tr')];
    expect(rows.map((r) => r.querySelector('.lvl')?.textContent)).toEqual(['PWH', 'PWL', 'PMH', 'PML', 'WO', 'MO', 'PDH', 'PDL']);
    const pwh = [...rows[0].querySelectorAll('td')].slice(1).map((td) => td.querySelector('input') ? (td.querySelector('input') as HTMLInputElement).checked : '—');
    expect(pwh).toEqual([true, '—', true, '—', false, '—']);
    expect(el.textContent).toContain('waiting for its seed');
    expect(el.textContent).toContain('4 rows');
    expect(el.querySelector<HTMLInputElement>('[data-testid="level-touch-band"]')?.value).toBe('0.1');
    const journal = [...el.querySelectorAll('tbody')].at(-1)?.textContent ?? '';
    expect(journal).toContain('PWH');
    expect(journal).toContain('breakout up');
    expect(journal).toContain('late');
  });

  it('sends only what changed: an event switch, a coin\'s PDH/PDL and the band; a bad band cannot be saved', async () => {
    const { cmp, sent } = await setup();
    expect(cmp.changed()).toBe(false);
    cmp.editEvent('PWH', 4, true);
    cmp.editCoin('BTCUSDT', 'daily', true);
    cmp.band.set('0.2');
    await cmp.save();
    expect(sent).toEqual([{ perCoin: { BTCUSDT: { enabled: true, daily: true } }, events: { PWH: { crossunder: true } }, touchBand: 0.002 }]);
    cmp.band.set('0');
    expect(cmp.patch()).toBeNull();
  });

  it('a cell where the event does not apply cannot be switched', async () => {
    const { cmp } = await setup();
    cmp.editEvent('PWH', 1, false);
    expect(cmp.grid()[0].cells[1]).toBeNull();
    expect(cmp.changed()).toBe(false);
  });

  it('the sending switch sends just that field', async () => {
    const { cmp, sent } = await setup();
    await cmp.setSwitch('enabled', true);
    expect(sent).toEqual([{ enabled: true }]);
    expect(cmp.page()?.settings.enabled).toBe(true);
  });
});

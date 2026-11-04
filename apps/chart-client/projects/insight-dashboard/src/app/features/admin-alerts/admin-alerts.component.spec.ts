import { TestBed } from '@angular/core/testing';
import { ApiError } from '@backtest-core/api/api-error';
import { OI_DIVERGENCE_DEFAULT_PARAMS, type WebAlertSettingsPatch, type WebAlertsAdminResponse, type WebOiDivergenceAlert } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import { AdminAlertsComponent } from './admin-alerts.component';

/** IB-112 (V17) — the admin alerts page against a stub API: what it shows, and what it sends. */
const ALERT: WebOiDivergenceAlert = {
  id: 7, symbol: 'TRXUSDT', tf: '1h', direction: 'bullish',
  a: { time: 1_793_700_000, price: 0.3, oiTime: 1_793_700_300, oi: 1_000_000 },
  b: { time: 1_793_790_000, price: 0.294, oiTime: 1_793_790_300, oi: 1_068_000 },
  runOf: null, runLength: 2, params: OI_DIVERGENCE_DEFAULT_PARAMS,
  confirmedAt: 1_793_815_200, firedAt: 1_793_815_560, late: false, recipients: 1,
  priceAtFire: 0.295, price4h: 0.3009, price24h: null, outcomeAt: null,
};
const PAGE: WebAlertsAdminResponse = {
  settings: { enabled: false, membersVisible: false, params: OI_DIVERGENCE_DEFAULT_PARAMS, updatedBy: null, updatedAt: Date.UTC(2026, 10, 4) / 1000 },
  symbols: [
    { symbol: 'BTCUSDT', base: 'BTC', enabled: true, addedAt: 0, addedBy: null },
    { symbol: 'TRXUSDT', base: 'TRX', enabled: false, addedAt: 0, addedBy: 1 },
  ],
  alerts: [ALERT],
  skips: [],
};

async function setup(api: Partial<Record<keyof InsightApiClient, unknown>> = {}) {
  const sent: unknown[] = [];
  TestBed.configureTestingModule({
    imports: [AdminAlertsComponent],
    providers: [{
      provide: InsightApiClient,
      useValue: {
        alertsAdmin: async () => PAGE,
        patchAlertSettings: async (p: WebAlertSettingsPatch) => { sent.push(['settings', p]); return { ...PAGE, settings: { ...PAGE.settings, ...p } }; },
        addAlertSymbol: async (s: string) => { sent.push(['add', s]); return { ...PAGE, symbols: [...PAGE.symbols, { symbol: s, base: s, enabled: true, addedAt: 1, addedBy: 1 }] }; },
        setAlertSymbolEnabled: async (s: string, on: boolean) => { sent.push(['toggle', s, on]); return PAGE; },
        removeAlertSymbol: async (s: string) => { sent.push(['remove', s]); return { ...PAGE, symbols: PAGE.symbols.filter((x) => x.symbol !== s) }; },
        ...api,
      },
    }],
  });
  TestBed.inject(I18nService).setLang('en');
  const fixture = TestBed.createComponent(AdminAlertsComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance, sent, el: fixture.nativeElement as HTMLElement };
}

const text = (el: HTMLElement) => el.textContent?.replace(/\s+/g, ' ') ?? '';

describe('AdminAlertsComponent (IB-112)', () => {
  it('shows both switches OFF by default, the coins, and the journal row in words', async () => {
    const { el } = await setup();
    expect(text(el)).toContain('Sending to Telegram: off');
    expect(text(el)).toContain('Visible to members: off');
    expect([...el.querySelectorAll('tbody tr')].map((r) => r.querySelector('td')?.textContent?.trim())).toContain('TRXUSDT');
    expect(text(el)).toContain('sent: 1');
    expect(text(el)).toContain('on lows');
  });

  it('turning sending on sends exactly {enabled: true}, and the page shows what came back', async () => {
    const { cmp, sent, fixture, el } = await setup();
    await cmp.setSwitch('enabled', true);
    fixture.detectChanges();
    expect(sent).toEqual([['settings', { enabled: true }]]);
    expect(text(el)).toContain('Sending to Telegram: on');
  });

  it('adds the coin as the venue spells it; a 409 is said in words', async () => {
    const ok = await setup();
    ok.cmp.newSymbol.set(' dogeusdt ');
    await ok.cmp.addSymbol();
    expect(ok.sent).toEqual([['add', 'DOGEUSDT']]);
    expect(ok.cmp.newSymbol()).toBe('');
    TestBed.resetTestingModule();
    const refused = await setup({ addAlertSymbol: async () => { throw new ApiError<string>(409, 'not_perpetual', 'x'); } });
    refused.cmp.newSymbol.set('BTCUSDT_260327');
    await refused.cmp.addSymbol();
    refused.fixture.detectChanges();
    expect(text(refused.el)).toContain('That is a quarterly future; a perpetual is needed.');
  });

  it('remove asks first; only «Yes» removes', async () => {
    const { cmp, sent } = await setup();
    cmp.askRemove('TRXUSDT');
    expect(sent).toEqual([]);
    await cmp.removeSymbol('TRXUSDT');
    expect(sent).toEqual([['remove', 'TRXUSDT']]);
    expect(cmp.confirmingRemove()).toBeNull();
  });

  it('params: unchanged or invalid cannot be saved; a valid change sends the whole params', async () => {
    const { cmp, sent } = await setup();
    expect(cmp.paramsChanged()).toBe(false);
    cmp.editParam('1h', 'k', '');
    expect(cmp.parsedParams()).toBeNull();
    await cmp.saveParams();
    expect(sent).toEqual([]);
    cmp.editParam('1h', 'k', '2');
    expect(cmp.paramsChanged()).toBe(true);
    await cmp.saveParams();
    expect(sent).toEqual([['settings', { params: { ...OI_DIVERGENCE_DEFAULT_PARAMS, perTf: { ...OI_DIVERGENCE_DEFAULT_PARAMS.perTf, '1h': { n: 6, k: 2, w: 120 } } } }]]);
  });
});

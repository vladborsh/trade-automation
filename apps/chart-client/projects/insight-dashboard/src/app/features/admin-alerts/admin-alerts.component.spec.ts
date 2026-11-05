import { TestBed } from '@angular/core/testing';
import { ApiError } from '@backtest-core/api/api-error';
import { OI_DIVERGENCE_DEFAULT_PARAMS, type WebAlertSettingsPatch, type WebAlertsAdminResponse, type WebOiDivergenceAlert } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import { AdminAlertsComponent } from './admin-alerts.component';

/** IB-112 (V17) — the admin alerts page against a stub API: what it shows, and what it sends. */
const ALERT: WebOiDivergenceAlert = {
  id: 7, source: 'live', symbol: 'TRXUSDT', tf: '1h', direction: 'bullish', kind: 'regular',
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
        // IB-122: the «Large liquidations» section inside the page has its own read
        liqAlertsAdmin: async () => ({ settings: { enabled: false, membersVisible: false, params: { perCoin: {} }, updatedAt: 0 }, coins: [], alerts: [] }),
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

  it('IB-141: the params table has N left and N right per TF — 4h shows 6 and 2', async () => {
    const { el } = await setup();
    expect([...el.querySelectorAll('table.params thead th')].map((th) => th.textContent?.trim())).toEqual([
      '', 'N left, candles before', 'N right, candles to confirm', 'k, candles to the pair', 'window, candles', 'hidden',
    ]);
    const row4h = [...el.querySelectorAll('table.params tbody tr')].find((r) => r.querySelector('td')?.textContent?.trim() === '4h') as HTMLElement;
    expect([...row4h.querySelectorAll('input:not([type=checkbox])')].map((i) => [i.getAttribute('aria-label'), (i as HTMLInputElement).value])).toEqual([
      ['4h N left, candles before', '6'], ['4h N right, candles to confirm', '2'], ['4h k, candles to the pair', '3'], ['4h window, candles', '90'],
    ]);
  });

  it('IB-116 (V33): a backfilled row is listed with a visible «from history» / «из истории» marker', async () => {
    const backfill: WebOiDivergenceAlert = { ...ALERT, id: 8, source: 'backfill', firedAt: null, recipients: 0 };
    const { el } = await setup({ alertsAdmin: async () => ({ ...PAGE, alerts: [ALERT, backfill] }) });
    const cell = [...el.querySelectorAll('td.history')];
    expect(cell.map((c) => c.textContent?.trim())).toEqual(['from history']);
    expect(text(el)).toContain('sent: 1'); // the live row beside it is unchanged
    TestBed.resetTestingModule();
    const ru = await setup({ alertsAdmin: async () => ({ ...PAGE, alerts: [backfill] }) });
    TestBed.inject(I18nService).setLang('ru');
    ru.fixture.detectChanges();
    expect(ru.el.querySelector('td.history')?.textContent?.trim()).toBe('из истории');
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
    cmp.editParam('4h', 'nRight', '3'); // IB-141: the right side alone
    cmp.editParam(null, 'priceLineTolAtrMult', '0'); // IB-114 (V18): 0 = the round-1 rule, a value, not «empty»
    expect(cmp.paramsChanged()).toBe(true);
    await cmp.saveParams();
    expect(sent).toEqual([['settings', { params: {
      ...OI_DIVERGENCE_DEFAULT_PARAMS, priceLineTolAtrMult: 0,
      perTf: {
        ...OI_DIVERGENCE_DEFAULT_PARAMS.perTf,
        '1h': { ...OI_DIVERGENCE_DEFAULT_PARAMS.perTf['1h'], k: 2 },
        '4h': { nLeft: 6, nRight: 3, k: 3, w: 90, sendHidden: false },
      },
    } }]]);
  });

  it('IB-144 (V42): a «hidden» checkbox per TF, labelled «<tf> hidden», off by default; ticking 1h saves the whole params with 1h on', async () => {
    const { el, cmp, sent, fixture } = await setup();
    const boxes = [...el.querySelectorAll<HTMLInputElement>('table.params input[type=checkbox]')];
    expect(boxes.map((b) => [b.getAttribute('aria-label'), b.checked])).toEqual([['15m hidden', false], ['1h hidden', false], ['4h hidden', false]]);
    expect(cmp.paramsChanged()).toBe(false);
    boxes[1].checked = true;
    boxes[1].dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(cmp.paramsChanged()).toBe(true);
    await cmp.saveParams();
    expect(sent).toEqual([['settings', { params: {
      ...OI_DIVERGENCE_DEFAULT_PARAMS,
      perTf: { ...OI_DIVERGENCE_DEFAULT_PARAMS.perTf, '1h': { ...OI_DIVERGENCE_DEFAULT_PARAMS.perTf['1h'], sendHidden: true } },
    } }]]);
  });

  it('IB-144 (V44): a hidden journal row says «hidden OI divergence» / «скрытая дивергенция OI»; the regular row beside it does not', async () => {
    const hidden: WebOiDivergenceAlert = { ...ALERT, id: 9, kind: 'hidden', b: { ...ALERT.b, price: 0.31, oi: 950_000 } };
    const { el, fixture } = await setup({ alertsAdmin: async () => ({ ...PAGE, alerts: [hidden, ALERT] }) });
    const rows = [...el.querySelectorAll('tbody tr')].filter((r) => r.textContent?.includes('on lows'));
    expect(rows.map((r) => r.querySelector('.kind')?.textContent?.trim() ?? null)).toEqual(['· hidden OI divergence', null]);
    TestBed.inject(I18nService).setLang('ru');
    fixture.detectChanges();
    expect(el.querySelector('.kind')?.textContent?.trim()).toBe('· скрытая дивергенция OI');
  });
});

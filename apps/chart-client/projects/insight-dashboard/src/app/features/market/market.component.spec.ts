import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import type { WebInsightsResponse, WebKpisResponse, WebLiquidationBlock, WebLiquidationsOverviewResponse, WebMarketPeriod } from '@trade-automation/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import insightsFixture from '../../../../../../../../libs/contracts/test/fixtures/insights.24h.json';
import kpisFixture from '../../../../../../../../libs/contracts/test/fixtures/kpis.json';
import blockFixture from '../../../../../../../../libs/contracts/test/fixtures/liquidation-block.24h.json';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import { MarketComponent } from './market.component';

/**
 * IB-088 — the shell as a COMPOSITION: the scheduler's rules are specced on their own
 * (`block-scheduler.spec.ts`); this is the joint between them and the page — which endpoint each
 * block calls with which period, what a period switch does to a request already in flight, and
 * that one failing block does not take the others down. The API is the contract fixtures.
 */
const overview = (period: WebMarketPeriod): WebLiquidationsOverviewResponse => ({
  asOf: 1_793_719_530, windows: [], perCoin: [], feed: [], feedMinUsd: 100_000,
  venues: { present: ['binance'], missing: [] }, unmappedRows: 0,
  block: { ...(blockFixture as unknown as WebLiquidationBlock), period },
});

interface Call { endpoint: string; period?: WebMarketPeriod }

function setup(opts: { p?: string; insightsDelayMs?: number; capsFail?: boolean } = {}) {
  const calls: Call[] = [];
  const navigate = vi.fn(async () => true);
  const api = {
    liquidationsOverview: async (_min: number, _limit: number, period: WebMarketPeriod) => { calls.push({ endpoint: 'liquidations', period }); return overview(period); },
    marketKpis: async () => { calls.push({ endpoint: 'kpis' }); return kpisFixture as unknown as WebKpisResponse; },
    marketInsights: (period: WebMarketPeriod) => {
      calls.push({ endpoint: 'insights', period });
      const body = { ...(insightsFixture as unknown as WebInsightsResponse), period };
      return new Promise<WebInsightsResponse>((r) => setTimeout(() => r(body), opts.insightsDelayMs ?? 0));
    },
    marketCards: async () => { calls.push({ endpoint: 'caps' }); if (opts.capsFail) throw new Error('502 from CoinGecko'); return null; },
  };
  TestBed.configureTestingModule({
    imports: [MarketComponent],
    providers: [
      { provide: InsightApiClient, useValue: api },
      { provide: Router, useValue: { navigate } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(opts.p ? { p: opts.p } : {}) } } },
    ],
  });
  TestBed.inject(I18nService).setLang('en');
  const fixture = TestBed.createComponent(MarketComponent);
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance, calls, navigate };
}

const count = (calls: Call[], endpoint: string) => calls.filter((c) => c.endpoint === endpoint).length;

describe('MarketComponent shell (IB-088)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_793_719_530_000); });
  afterEach(() => { TestBed.resetTestingModule(); vi.useRealTimers(); });

  it('reads ?p= and asks every block once, each with the page period', async () => {
    const { calls } = setup({ p: '4h' });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(expect.arrayContaining([
      { endpoint: 'liquidations', period: '4h' }, { endpoint: 'insights', period: '4h' }, { endpoint: 'kpis' }, { endpoint: 'caps' },
    ]));
    expect(calls).toHaveLength(4);
  });

  it('an unknown ?p= is 24h, not an error', async () => {
    const { calls } = setup({ p: '1y' });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.find((c) => c.endpoint === 'insights')?.period).toBe('24h');
  });

  it('one minute: liquidations 7×, insights and KPIs 2×, caps once — the cadences reach the endpoints', async () => {
    const { calls } = setup();
    await vi.advanceTimersByTimeAsync(60_000);
    expect({ liq: count(calls, 'liquidations'), ins: count(calls, 'insights'), kpis: count(calls, 'kpis'), caps: count(calls, 'caps') })
      .toEqual({ liq: 7, ins: 2, kpis: 2, caps: 1 });
  });

  it('a period switch DURING a request: the old answer is dropped, the new period is asked at once, the URL carries it', async () => {
    const { cmp, calls, navigate } = setup({ insightsDelayMs: 3_000 });
    await vi.advanceTimersByTimeAsync(1_000); // 24h insights request still running
    cmp.onPeriodChange('1h');
    await vi.advanceTimersByTimeAsync(2_000); // the 24h answer lands now
    expect(cmp.insights()).toBeNull();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(cmp.insights()?.period).toBe('1h');
    expect(calls.filter((c) => c.endpoint === 'insights').map((c) => c.period)).toEqual(['24h', '1h']);
    expect(cmp.liquidations()?.block.period).toBe('1h');
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { p: '1h' }, replaceUrl: true }));
  });

  it('a failing block shows its error on itself only; the others render', async () => {
    const { fixture, cmp } = setup({ capsFail: true });
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const errors = [...el.querySelectorAll('.error')].map((e) => e.textContent ?? '');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('502 from CoinGecko');
    expect(cmp.blockError('kpis')).toBeNull();
    expect(el.querySelector('app-kpi-strip')?.textContent).toMatch(/\$2\.62T|2\.62/);
  });

  it('a hidden tab asks nothing; coming back asks every block once', async () => {
    const { calls } = setup();
    await vi.advanceTimersByTimeAsync(0);
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    const before = calls.length;
    await vi.advanceTimersByTimeAsync(600_000);
    expect(calls.length).toBe(before);
    vis.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.length).toBe(before + 4);
    vis.mockRestore();
  });

  it('there is no Refresh button: the page refreshes itself', () => {
    const { fixture } = setup();
    const labels = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(labels).not.toContain('Refresh');
    expect(labels).toEqual(['1h', '4h', '24h', '7d'].map((p) => expect.stringContaining(p)));
  });
});

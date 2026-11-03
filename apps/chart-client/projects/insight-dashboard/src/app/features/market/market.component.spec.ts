import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import type { WebCapsResponse, WebInsightsResponse, WebKpisResponse, WebPositioningResponse, WebLiquidationBlock, WebLiquidationsOverviewResponse, WebMarketPeriod } from '@trade-automation/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import insightsFixture from '../../../../../../../../libs/contracts/test/fixtures/insights.24h.json';
import kpisFixture from '../../../../../../../../libs/contracts/test/fixtures/kpis.json';
import blockFixture from '../../../../../../../../libs/contracts/test/fixtures/liquidation-block.24h.json';
import positioningFixture from '../../../../../../../../libs/contracts/test/fixtures/positioning.24h.json';
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

const caps = (period: WebMarketPeriod): WebCapsResponse => ({
  period, coins: [{ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', capUsd: 1.5e12, priceUsd: 77_000, changePct: 1.2, stable: false }],
  coinsUnavailable: null, changeUnavailable: null, dominanceUnavailable: null,
  dominance: { btcPct: 59, ethPct: 11, stablesPct: 8, restPct: 22, totalCapUsd: 2.6e12, totalCapChangePct24h: -1, stablesCounted: 10, asOf: '2026-11-03T17:00:00Z' },
  source: { name: 'CoinGecko', url: 'https://www.coingecko.com' }, generatedAt: '2026-11-03T17:00:00Z',
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
    marketCards: async () => { calls.push({ endpoint: 'sentiment' }); return null; },
    marketPositioning: async (period: WebMarketPeriod) => { calls.push({ endpoint: 'positioning', period }); return { ...(positioningFixture as unknown as WebPositioningResponse), period }; },
    marketCaps: async (period: WebMarketPeriod) => { calls.push({ endpoint: 'caps', period }); if (opts.capsFail) throw new Error('502 from CoinGecko'); return caps(period); },
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
      { endpoint: 'liquidations', period: '4h' }, { endpoint: 'insights', period: '4h' }, { endpoint: 'kpis' },
      { endpoint: 'positioning', period: '4h' }, { endpoint: 'caps', period: '4h' }, { endpoint: 'sentiment' },
    ]));
    expect(calls).toHaveLength(6);
  });

  it('an unknown ?p= is 24h, not an error', async () => {
    const { calls } = setup({ p: '1y' });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.find((c) => c.endpoint === 'insights')?.period).toBe('24h');
  });

  it('one minute: liquidations 7×, insights / KPIs / positioning 2×, caps and sentiment once — the cadences reach the endpoints', async () => {
    const { calls } = setup();
    await vi.advanceTimersByTimeAsync(60_000);
    const n = (e: string) => count(calls, e);
    expect({ liq: n('liquidations'), ins: n('insights'), kpis: n('kpis'), pos: n('positioning'), caps: n('caps'), sent: n('sentiment') })
      .toEqual({ liq: 7, ins: 2, kpis: 2, pos: 2, caps: 1, sent: 1 });
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
    expect([cmp.positioning()?.period, cmp.caps()?.period]).toEqual(['1h', '1h']); // IB-090: both blocks follow the period
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
    expect(calls.length).toBe(before + 6);
    vis.mockRestore();
  });

  it('there is no Refresh button: the page refreshes itself', () => {
    const { fixture } = setup();
    const labels = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(labels).not.toContain('Refresh');
    expect(labels).toEqual(['1h', '4h', '24h', '7d'].map((p) => expect.stringContaining(p)));
  });
});

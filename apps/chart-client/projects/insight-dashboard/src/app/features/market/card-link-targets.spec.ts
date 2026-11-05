import { TestBed } from '@angular/core/testing';
import { provideRouter, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { WebCapsResponse, WebFlowsResponse, WebInsightsResponse, WebInsightStatement, WebKpisResponse, WebLiquidationBlock, WebLiquidationsOverviewResponse, WebMarketPeriod, WebPositioningResponse } from '@trade-automation/contracts';
import { WEB_INSIGHT_BLOCKS, WebInsightLinkSchema } from '@trade-automation/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import insightsFixture from '../../../../../../../../libs/contracts/test/fixtures/insights.24h.json';
import kpisFixture from '../../../../../../../../libs/contracts/test/fixtures/kpis.json';
import blockFixture from '../../../../../../../../libs/contracts/test/fixtures/liquidation-block.24h.json';
import positioningFixture from '../../../../../../../../libs/contracts/test/fixtures/positioning.24h.json';
import flowsFixture from '../../../../../../../../libs/contracts/test/fixtures/flows.24h.json';
import { routes } from '../../app.routes';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import { cardLinkTarget } from './shell/insight-card';

/**
 * IB-BUG-035 — every place a «Главное сейчас» card can send a member exists. The «К позициям ↓» link
 * pointed at `#positioning` and led nowhere; nothing checked the joint between what the rules can
 * emit and what the page and the router actually have.
 *
 * The set of targets is DERIVED, not listed: every block the contract lets a rule name as its link
 * (`WEB_INSIGHT_BLOCKS` — the type `rules.ts` must satisfy, so a superset of what it emits) and every
 * route kind of `WebInsightLinkSchema`. Each one goes through the card's own `cardLinkTarget`, and
 * the result must be a route in `app.routes` (not the `**` fallback) or an element id on the Market
 * page as it renders with every block loaded.
 */
const NOW = 1_793_719_530;
const PERIOD: WebMarketPeriod = '24h';
const basis = { window: PERIOD, venues: ['binance'], sampleWindows: 30, observedWindows: 30, from: null };
const statement = (link: WebInsightStatement['link'], block: WebInsightStatement['block']): WebInsightStatement => ({
  ruleId: 'R7', block, key: 'insight.breadth', params: {}, rarity: 0.95, magnitude: 1, basis, link, chart: null,
});

/** Every link a rule can emit, by the contract: one per block anchor, one per route kind. */
function everyLink(): WebInsightStatement[] {
  const anchors = WEB_INSIGHT_BLOCKS.map((anchor) => statement({ anchor }, anchor));
  const routeKinds = WebInsightLinkSchema.options
    .map((o) => o.shape)
    .filter((shape): shape is typeof shape & { route: { value: string } } => 'route' in shape)
    .map((shape) => statement({ route: shape.route.value as 'instrument', symbol: 'BTCUSDT', timeSec: NOW }, 'liquidations'));
  return [...anchors, ...routeKinds];
}

/** A path matches a configured route that renders something — redirects and `**` do not count. */
function routeExists(config: Routes, commands: string[]): boolean {
  const segments = commands.join('/').split('/').filter((s) => s.length > 0);
  return config.some((r) => {
    if (r.redirectTo !== undefined || r.path === undefined || r.path === '**') return false;
    const parts = r.path.split('/').filter((s) => s.length > 0);
    return parts.length === segments.length && parts.every((p, i) => p.startsWith(':') || p === segments[i]);
  });
}

const overview = (period: WebMarketPeriod): WebLiquidationsOverviewResponse => ({
  asOf: NOW, windows: [], perCoin: [], feed: [], feedMinUsd: 100_000,
  venues: { present: ['binance'], missing: [] }, unmappedRows: 0,
  block: { ...(blockFixture as unknown as WebLiquidationBlock), period },
});
const caps = (period: WebMarketPeriod): WebCapsResponse => ({
  period, coins: [{ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', capUsd: 1.5e12, priceUsd: 77_000, changePct: 1.2, stable: false }],
  coinsUnavailable: null, changeUnavailable: null, dominanceUnavailable: null,
  dominance: { btcPct: 59, ethPct: 11, stablesPct: 8, restPct: 22, totalCapUsd: 2.6e12, totalCapChangePct24h: -1, stablesCounted: 10, asOf: '2026-11-03T17:00:00Z' },
  source: { name: 'CoinGecko', url: 'https://www.coingecko.com' }, generatedAt: '2026-11-03T17:00:00Z',
});

/**
 * IB-BUG-045 — a test here draws the WHOLE Market page under the real router (≈ 900 nodes, the
 * route's lazy chunk loaded inside the test): 0.5–1.5 s CPU per render (2026-11-05, 3 runs), and
 * 6–8 s wall at load 120–400 on 8 cores, past vitest's 5 s default. It cannot be lighter: the
 * question is what the whole page has. The budget is per whole-page render (as market.component.spec).
 */
const WHOLE_PAGE_MS = 20_000;

/** The Market page at `/market?p=24h` under the real routes, every block loaded from the contract fixtures. */
async function marketPage(): Promise<HTMLElement> {
  const api = {
    liquidationsOverview: async (_min: number, _limit: number, period: WebMarketPeriod) => overview(period),
    marketKpis: async () => kpisFixture as unknown as WebKpisResponse,
    marketInsights: async (period: WebMarketPeriod) => ({ ...(insightsFixture as unknown as WebInsightsResponse), period }),
    marketCards: async () => null,
    marketPositioning: async (period: WebMarketPeriod) => ({ ...(positioningFixture as unknown as WebPositioningResponse), period }),
    marketCaps: async (period: WebMarketPeriod) => caps(period),
    marketFlows: async (period: WebMarketPeriod) => ({ ...(flowsFixture as unknown as WebFlowsResponse), period }),
  };
  TestBed.configureTestingModule({ providers: [provideRouter(routes), { provide: InsightApiClient, useValue: api }] });
  TestBed.inject(I18nService).setLang('ru');
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(`/market?p=${PERIOD}`);
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0));
    harness.detectChanges();
  }
  return harness.routeNativeElement as HTMLElement;
}

describe('IB-BUG-035 — every card link target exists', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('the derived set covers every block and the instrument route', () => {
    const targets = everyLink().map((s) => cardLinkTarget(s, NOW));
    expect(targets).toHaveLength(WEB_INSIGHT_BLOCKS.length + 1);
    expect(targets.filter((t) => t.kind === 'route').map((t) => t.kind === 'route' && t.commands[0])).toEqual(['/positioning', '/instrument']);
  });

  it('a route target is a route the app has; a block target is an id on the Market page', async () => {
    const page = await marketPage();
    const missing: string[] = [];
    for (const s of everyLink()) {
      const t = cardLinkTarget(s, NOW);
      if (t.kind === 'route' && !routeExists(routes, t.commands)) missing.push(`route ${t.commands.join('/')}`);
      if (t.kind === 'block' && page.querySelector(`[id="${t.id}"]`) === null) missing.push(`#${t.id} on /market`);
    }
    expect(missing).toEqual([]);
  }, WHOLE_PAGE_MS);

  it('on the page, no card link is a bare #href; the fixture\'s R5 card opens /positioning with its period', async () => {
    const page = await marketPage();
    const links = [...page.querySelectorAll<HTMLAnchorElement>('app-insight-card a.link')];
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) expect(a.getAttribute('href')).toMatch(/^\//);
    const all = links.find((a) => a.textContent?.trim() === 'Все монеты →');
    expect(all?.getAttribute('href')).toBe(`/positioning?p=${PERIOD}`);
  }, WHOLE_PAGE_MS);

  it('routeExists: the matcher is not the `**` fallback', () => {
    expect(routeExists(routes, ['/instrument', 'BTCUSDT'])).toBe(true);
    expect(routeExists(routes, ['/positioning'])).toBe(true);
    expect(routeExists(routes, ['/nowhere'])).toBe(false);
    expect(routeExists(routes, ['/instrument'])).toBe(false);
  });
});

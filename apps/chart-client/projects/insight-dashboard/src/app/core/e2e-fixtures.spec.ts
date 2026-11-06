import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  WebAlertsAdminResponseSchema, WebCalendarEventsResponseSchema, WebCandlesResponseSchema, WebCapsResponseSchema, WebDbHealthResponseSchema,
  WebFundingResponseSchema, WebInsightsResponseSchema, WebLiquidationEpisodesResponseSchema, WebKpisResponseSchema, WebLiquidationEventsResponseSchema, WebLiquidationsOverviewResponseSchema,
  WebLiquidationsResponseSchema, WebLoginEventsResponseSchema, WebLongShortResponseSchema, WebMarketCardsResponseSchema, WebMeResponseSchema,
  WebMembersResponseSchema, WebOpenInterestResponseSchema, WebPositioningResponseSchema, WebStreamsResponseSchema, WebTopLiquidationSchema,
  WebUniverseSummaryResponseSchema, WebUniverseTopResponseSchema, WebLiqAlertsAdminResponseSchema, WebFundingAlertsAdminResponseSchema, WebLevelAlertsAdminResponseSchema,
} from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * IB-BUG-038 — every e2e fixture parses through its contract schema, under `npm test`.
 *
 * The dashboard e2e answers `/api/web/*` from its own captured copies in `e2e-insight-dashboard/fixtures/`,
 * which no unit spec loaded. IB-118 added a required field (`WebKpiTile.history`) to the contract and its
 * fixture; the e2e copy kept the old shape, `npm test` stayed green, and the e2e went red on master
 * (22 failed). A test, not a rule: a contract change that leaves an e2e fixture behind now fails here.
 *
 * Every file in the folder is in exactly one of the two lists below; a new fixture in neither fails
 * the spec, so the next one cannot slip past.
 */
// Built from cwd rather than `__dirname`, which does not exist in the ESM the runner loads (no-literals.spec.ts).
const FIXTURES_DIR = join(process.cwd(), 'e2e-insight-dashboard', 'fixtures');

/** `/series/liquidations/top` has a row schema but no response schema; this is the client's declared type (insight-api.client.ts). */
const TopLiquidationsResponseSchema = z.object({ symbol: z.string(), rows: z.array(WebTopLiquidationSchema) });

/** One file, one response. */
const SINGLE: Record<string, z.ZodTypeAny> = {
  'admin-alerts.synthetic.json': WebAlertsAdminResponseSchema,
  // IB-122: slot dev-3's LiqAlertsAdmin answer (2026-11-05)
  'admin-alerts-liq.json': WebLiqAlertsAdminResponseSchema,
  // IB-124: slot dev-3's FundingAlertsAdmin answer (2026-11-06)
  'admin-alerts-funding.json': WebFundingAlertsAdminResponseSchema,
  // IB-126: slot dev-1's LevelAlertsAdmin answer (2026-11-06)
  'admin-alerts-levels.json': WebLevelAlertsAdminResponseSchema,
  'admin-health-db.json': WebDbHealthResponseSchema,
  'admin-health-streams.json': WebStreamsResponseSchema,
  'admin-login-events.json': WebLoginEventsResponseSchema,
  'admin-members.json': WebMembersResponseSchema,
  'context-cards.json': WebMarketCardsResponseSchema,
  // IB-134: the box's answers at 2026-11-05 14:27 UTC, rebuilt with the shipped IB-133 functions over the box's prints
  'liquidation-episodes.box-7d.json': WebLiquidationEpisodesResponseSchema,
  'liquidation-episodes.box-24h.json': WebLiquidationEpisodesResponseSchema,
  'liquidations-overview.24h.json': WebLiquidationsOverviewResponseSchema,
  'market-caps.4h.json': WebCapsResponseSchema,
  'market-caps.24h.json': WebCapsResponseSchema,
  'market-insights.24h.json': WebInsightsResponseSchema,
  'market-insights-charts.24h.json': WebInsightsResponseSchema, // IB-119: the mockup's cards with charts (synthetic)
  'market-kpis.json': WebKpisResponseSchema,
  'market-positioning.24h.json': WebPositioningResponseSchema,
};

/** A recording: `{ responses: { "<path>?<query>": { status, body } } }`, each body parsed by its path. */
const RECORDINGS: Record<string, Record<string, z.ZodTypeAny>> = {
  'instrument-btcusdt.json': {
    '/auth/me': WebMeResponseSchema,
    '/calendar/events': WebCalendarEventsResponseSchema,
    '/context/cards': WebMarketCardsResponseSchema,
    '/liquidations/overview': WebLiquidationsOverviewResponseSchema,
    '/series/candles': WebCandlesResponseSchema,
    '/series/funding': WebFundingResponseSchema,
    '/series/liquidations': WebLiquidationsResponseSchema,
    '/series/liquidations/events': WebLiquidationEventsResponseSchema,
    '/series/liquidations/top': TopLiquidationsResponseSchema,
    '/series/ls': WebLongShortResponseSchema,
    '/series/oi': WebOpenInterestResponseSchema,
    '/universe/summary': WebUniverseSummaryResponseSchema,
    '/universe/top': WebUniverseTopResponseSchema,
  },
};

const read = (file: string): unknown => JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf8'));
const issues = (schema: z.ZodTypeAny, body: unknown): string[] => {
  const r = schema.safeParse(body);
  return r.success ? [] : r.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('e2e fixtures parse through their contract schemas (IB-BUG-038)', () => {
  it('every fixture file is mapped — a new one in neither list fails here', () => {
    const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json')).sort();
    expect(files.length).toBeGreaterThan(0); // the folder was found: an empty list proves nothing
    const mapped = new Set([...Object.keys(SINGLE), ...Object.keys(RECORDINGS)]);
    expect(files.filter((f) => !mapped.has(f))).toEqual([]);
    expect([...mapped].filter((f) => !files.includes(f)).sort()).toEqual([]); // and no stale entry
  });

  it.each(Object.entries(SINGLE))('%s', (file, schema) => {
    expect(issues(schema, read(file))).toEqual([]);
  });

  it.each(Object.entries(RECORDINGS))('%s: every recorded response, by its path', (file, byPath) => {
    const rec = read(file) as { responses: Record<string, { status: number; body: unknown }> };
    const entries = Object.entries(rec.responses);
    expect(entries.length).toBeGreaterThan(0);
    const unmapped = entries.map(([key]) => key.split('?')[0]).filter((p) => !(p in byPath));
    expect(unmapped).toEqual([]);
    const failures = entries.filter(([, r]) => r.status === 200).flatMap(([key, r]) => issues(byPath[key.split('?')[0]], r.body).map((m) => `${key} — ${m}`));
    expect(failures).toEqual([]);
  });

  it('the guard can disagree: the KPI fixture without one tile\'s history fails its schema', () => {
    const kpis = read('market-kpis.json') as { tiles: Array<Record<string, unknown>> };
    const { history: _dropped, ...first } = kpis.tiles[0];
    expect(issues(WebKpisResponseSchema, { ...kpis, tiles: [first, ...kpis.tiles.slice(1)] })).not.toEqual([]);
  });
});

import { Logger } from '@nestjs/common';
import type { WebInsightsResponse, WebMarketPeriod } from '@trade-automation/contracts';
import { runInsights } from './engine';
import { RULES } from './rules';
import { INSIGHTS_CACHE_MS } from './thresholds';
import type { InsightSnapshot } from './types';

/**
 * IB-086 (D1) — builds the snapshot from the market services (not HTTP) and runs the engine.
 * Ports, not classes, so this module imports nothing from `web/`: the web module wires the
 * liquidation block (IB-084), positioning (IB-085), breadth and Fear & Greed into it, and alerts
 * can wire the same ports later. A port that fails is a null part of the snapshot: its rules refuse
 * with `no_data`, the others still run. Cached 60 s per period (D13).
 */
export interface InsightPorts {
  liquidations?: (period: WebMarketPeriod) => Promise<InsightSnapshot['liquidations']>;
  positioning?: (period: WebMarketPeriod) => Promise<InsightSnapshot['positioning']>;
  /** IB-107 (D24): the positioning baselines' tails for R4/R5/R6's sparks — the same cached read. */
  positioningSeries?: () => Promise<InsightSnapshot['positioningSeries']>;
  /** IB-113 (V16): the OI divergence journal's newest on-time alert of the last 24 h, with its OI series. */
  oiDivergence?: (nowMs: number) => Promise<InsightSnapshot['oiDivergence']>;
  /** IB-113 (V16, TL): `alert_settings.members_visible` — whether a non-admin sees R11. Absent or failed → hidden. */
  oiAlertsMembersVisible?: () => Promise<boolean>;
  breadth?: (period: WebMarketPeriod) => Promise<InsightSnapshot['breadth']>;
  fng?: () => Promise<number | null>;
  /** IB-091: «Деривативы и потоки» for R8–R10. */
  flows?: (period: WebMarketPeriod) => Promise<InsightSnapshot['flows']>;
}

export interface InsightsServiceOptions {
  ports: InsightPorts;
  cache: { getOrLoad<V>(key: string, ttlMs: number, load: () => Promise<V>): Promise<V> };
  now?: () => number;
}

export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);
  private readonly now: () => number;

  constructor(private readonly options: InsightsServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  /**
   * The period's statements for this viewer. IB-113 (TL review): R11 is owner-first like the rest of
   * the alerts — an admin always sees it, anyone else only while `members_visible` is on; hidden, the
   * other rules rank as if it did not exist. One snapshot per period is cached (the reads are shared);
   * the engine — pure, a few dozen comparisons — runs per request on the viewer's variant. Default:
   * hidden.
   */
  async insights(period: WebMarketPeriod, viewer: { admin: boolean } = { admin: false }): Promise<WebInsightsResponse> {
    const { snapshot, membersVisible } = await this.snapshot(period);
    const sees = viewer.admin || membersVisible;
    const view: InsightSnapshot = sees ? snapshot : { ...snapshot, oiDivergence: null };
    return { ...runInsights(RULES, view), asOf: Math.floor(snapshot.nowMs / 1000) };
  }

  private snapshot(period: WebMarketPeriod): Promise<{ snapshot: InsightSnapshot; membersVisible: boolean }> {
    return this.options.cache.getOrLoad(`insights:snapshot:${period}`, INSIGHTS_CACHE_MS, async () => {
      const nowMs = this.now();
      const soft = async <T>(label: string, f: (() => Promise<T>) | undefined): Promise<T | null> => {
        if (!f) return null;
        try {
          return await f();
        } catch (error) {
          this.logger.warn(`insights ${label}: ${(error as Error).message}`);
          return null;
        }
      };
      const p = this.options.ports;
      const [liquidations, positioning, positioningSeries, breadth, fng, flows, oiDivergence, membersVisible] = await Promise.all([
        soft('liquidations', p.liquidations && (() => (p.liquidations as NonNullable<InsightPorts['liquidations']>)(period))),
        soft('positioning', p.positioning && (() => (p.positioning as NonNullable<InsightPorts['positioning']>)(period))),
        soft('positioning series', p.positioningSeries),
        soft('breadth', p.breadth && (() => (p.breadth as NonNullable<InsightPorts['breadth']>)(period))),
        soft('fng', p.fng),
        soft('flows', p.flows && (() => (p.flows as NonNullable<InsightPorts['flows']>)(period))),
        soft('oi divergence', p.oiDivergence && (() => (p.oiDivergence as NonNullable<InsightPorts['oiDivergence']>)(nowMs))),
        soft('oi alerts visibility', p.oiAlertsMembersVisible),
      ]);
      const snapshot: InsightSnapshot = { period, nowMs, liquidations, positioning, positioningSeries, breadth, fng, flows, oiDivergence };
      return { snapshot, membersVisible: membersVisible === true };
    });
  }
}

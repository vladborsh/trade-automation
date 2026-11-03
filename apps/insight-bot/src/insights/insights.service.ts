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
  breadth?: (period: WebMarketPeriod) => Promise<InsightSnapshot['breadth']>;
  fng?: () => Promise<number | null>;
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

  async insights(period: WebMarketPeriod): Promise<WebInsightsResponse> {
    return this.options.cache.getOrLoad(`insights:${period}`, INSIGHTS_CACHE_MS, async () => {
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
      const [liquidations, positioning, breadth, fng] = await Promise.all([
        soft('liquidations', p.liquidations && (() => (p.liquidations as NonNullable<InsightPorts['liquidations']>)(period))),
        soft('positioning', p.positioning && (() => (p.positioning as NonNullable<InsightPorts['positioning']>)(period))),
        soft('breadth', p.breadth && (() => (p.breadth as NonNullable<InsightPorts['breadth']>)(period))),
        soft('fng', p.fng),
      ]);
      const snapshot: InsightSnapshot = { period, nowMs, liquidations, positioning, breadth, fng };
      return { ...runInsights(RULES, snapshot), asOf: Math.floor(nowMs / 1000) };
    });
  }
}

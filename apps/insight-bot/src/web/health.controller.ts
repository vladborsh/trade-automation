import { Controller, Get, Inject } from '@nestjs/common';
import type { WebDbHealthResponse, WebLiquidationUptime, WebStreamsResponse } from '@trade-automation/contracts';
import { LIQUIDATION_STREAMS } from '../collectors/uptime/liquidation-streams';
import { DB, type Db } from '../db/db.port';
import { gapsOverlapping, heartbeats, liquidationActivity } from '../db/pg/uptime-reads';
import { databaseHealth } from '../db/pg/web-reads';
import { liquidationUptime } from './liquidation-uptime';
import { MetricsService } from '../ops/metrics.service';
import { StreamRegistry } from '../ops/stream-registry';
import { AdminOnly } from './auth/web-auth.guard';

/** Binance's futures REST budget, 2400 weight/min (design §4.5, AGENTS.md). */
const BINANCE_WEIGHT_BUDGET = 2400;

/** Spot has its own 6000/min ceiling on `api.binance.com` (design §4.5) — never the futures one. */
const BINANCE_SPOT_WEIGHT_BUDGET = 6000;

/**
 * architecture/insight-bot-web-dashboard.md §4 — the dashboard's health detail, under `/api/web`.
 *
 * **Not the ops `GET /healthz`** (WD-011; it was `GET /health`). That one is the unauthenticated
 * liveness probe, answers `{ status }` only, and is what the SPA fallback excludes. This one exposes per-stream detail, liquidation-collector uptime and database internals, and
 * is behind IB-029's `APP_GUARD` on `/api/web`: one place decides who may read the dashboard, not
 * two. Keep the two apart; converging them would make the detailed one public.
 *
 * IB-075 (member-access design M8): the whole controller is `@AdminOnly` — a member gets 403
 * FORBIDDEN on every route here, including ones added later. The same guard enforces it; the
 * decorator only marks the class. Pinned by test/web/health-admin-only.spec.ts.
 *
 * WD-009: `gap-reports` (the daily candle-gap grid) is gone with the candle tape it reported on;
 * `streams` now also carries the three liquidation collectors' uptime (`liquidation-uptime.ts`),
 * which used to live on the coverage page.
 */
@AdminOnly()
@Controller('api/web/health')
export class WebHealthController {
  constructor(
    private readonly streams: StreamRegistry,
    private readonly metrics: MetricsService,
    @Inject(DB) private readonly db: Db | null,
  ) {}

  @Get('streams')
  async getStreams(): Promise<WebStreamsResponse> {
    return {
      streams: this.streams.snapshot().map((s) => ({
        id: s.id,
        venue: s.venue,
        mode: s.mode,
        reason: s.degradedReason,
        lastMessageAgeSec: s.lastMessageAgeSec,
        reconnects24h: s.reconnects24h,
        gapsOpen: s.gapsOpen,
      })),
      weights: [
        { market: 'futures', used1m: this.metrics.getBinanceWeightUsed1m(), budget1m: BINANCE_WEIGHT_BUDGET },
        { market: 'spot', used1m: this.metrics.getBinanceSpotWeightUsed1m(), budget1m: BINANCE_SPOT_WEIGHT_BUDGET },
      ],
      liquidationUptime: await this.liquidationUptime(),
    };
  }

  /** The three liquidation collectors over 24 h and 7 d. Without a database there is no record: []. */
  private async liquidationUptime(now = new Date()): Promise<WebLiquidationUptime[]> {
    if (!this.db) return [];
    const from7d = new Date(now.getTime() - 7 * 86_400_000);
    const from24h = new Date(now.getTime() - 86_400_000);
    const [beats, gaps, activity] = await Promise.all([
      heartbeats(this.db),
      gapsOverlapping(this.db, from7d, now, LIQUIDATION_STREAMS.map((s) => s.stream)),
      liquidationActivity(this.db, from7d, from24h),
    ]);
    return liquidationUptime(LIQUIDATION_STREAMS, beats, gaps, activity, now);
  }

  @Get('db')
  async getDb(): Promise<WebDbHealthResponse> {
    if (!this.db) return { sizeBytes: 0, partitionHorizon: null, partitionCount: 0 };
    return databaseHealth(this.db);
  }
}

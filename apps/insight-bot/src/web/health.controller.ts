import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { WebDbHealthResponse, WebGapReportsResponse, WebStreamsResponse } from '@trade-automation/contracts';
import { DB, type Db } from '../db/db.port';
import { databaseHealth, recentGapReports, toGapCells } from '../db/pg/web-reads';
import { BINANCE_WEIGHT_BUDGET } from '../ops/gap-report';
import { MetricsService } from '../ops/metrics.service';
import { StreamRegistry } from '../ops/stream-registry';

/** Spot has its own 6000/min ceiling on `api.binance.com` (design §4.5) — never the futures one. */
const BINANCE_SPOT_WEIGHT_BUDGET = 6000;

/**
 * architecture/insight-bot-web-dashboard.md §4 — the dashboard's health detail, under `/api/web`.
 *
 * **Not the ops `GET /health`.** That one is the unauthenticated liveness probe (and what the SPA
 * fallback excludes); this one exposes per-stream detail, gap history and database internals, and
 * is behind IB-029's `APP_GUARD` on `/api/web` — which is why no guard decorator appears here: one
 * place decides who may read the dashboard, not two. Keep the two apart; converging them would
 * make the detailed one public.
 */
@Controller('api/web/health')
export class WebHealthController {
  constructor(
    private readonly streams: StreamRegistry,
    private readonly metrics: MetricsService,
    @Inject(DB) private readonly db: Db | null,
  ) {}

  @Get('streams')
  getStreams(): WebStreamsResponse {
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
    };
  }

  @Get('gap-reports')
  async getGapReports(@Query('days') days?: string): Promise<WebGapReportsResponse> {
    // clamped: the grid is a fixed-width page, and an unbounded `days` is an unbounded query
    const window = Math.min(Math.max(Number(days) || 14, 1), 90);
    if (!this.db) return { days: [], cells: [] };
    const reports = await recentGapReports(this.db, window);
    return { days: reports.map((r) => r.day), cells: toGapCells(reports) };
  }

  @Get('db')
  async getDb(): Promise<WebDbHealthResponse> {
    if (!this.db) return { sizeBytes: 0, partitionHorizon: null, partitionCount: 0 };
    return databaseHealth(this.db);
  }
}

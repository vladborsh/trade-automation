import { Controller, Get } from '@nestjs/common';

/** The whole response. Pinned to exactly this shape in test/ops.spec.ts. */
export interface LivenessResponse {
  status: 'ok';
}

/**
 * WD-011 (architecture/storage-ruling-2026-11-03.md S7) — the unauthenticated liveness probe that
 * the compose healthcheck and `deploy.sh` read. It answers `{ status }` and nothing else: this
 * route was `GET /health`, and it used to serve the stream list, the database lag, the Binance
 * weight and `noSpot`. That detail is for the admin only and lives at `/api/web/health/*`
 * (`@AdminOnly`, IB-075).
 *
 * The path moved from `/health` to `/healthz` because `/health` belongs to the dashboard's admin
 * Health page: with the bundle present, a reload of `/health` gets `index.html` (static.module.ts
 * excludes `/healthz`, not `/health`).
 *
 * It answers without consulting a collector, the database or anything else. If the process can
 * route a request, it is alive. Whether the collectors are healthy is a separate question,
 * answered by the watchdog and the admin page.
 */
@Controller('healthz')
export class HealthController {
  @Get()
  get(): LivenessResponse {
    return { status: 'ok' };
  }
}

import { Controller, Get, Header, NotFoundException, Req } from '@nestjs/common';
import { clientIpHeaderName } from '../config/client-ip-header';
import { AppConfigService } from '../config/config.service';
import { MetricsService } from './metrics.service';

/**
 * §6.1 — the Prometheus scrape endpoint. It has no auth, so it must only answer from the box itself.
 *
 * WD-011 H7 (architecture/https-without-domain-2026-11-03.md): when `CLIENT_IP_HEADER` is set, any
 * request that CARRIES that header gets 404. On the box the header is `x-real-ip`, and Caddy sets it
 * on every request it proxies, so a request that has it came from outside. Someone who forges the
 * header only gets a 404 back. With the variable unset (every dev slot) the endpoint stays open.
 *
 * Caddy also answers `/metrics` with 404 itself. The two layers exist because either one, edited
 * alone, would fail silently. The 404 copies Nest's answer to an unrouted path, so from outside the
 * route looks absent rather than forbidden.
 */
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: AppConfigService,
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain')
  async get(@Req() req: { headers: Record<string, unknown> }): Promise<string> {
    const header = clientIpHeaderName(this.config.env.get('CLIENT_IP_HEADER'));
    if (header !== undefined && req.headers[header] !== undefined) {
      throw new NotFoundException('Cannot GET /metrics');
    }
    return this.metrics.registry.metrics();
  }
}

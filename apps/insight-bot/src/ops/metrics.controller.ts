import { Controller, Get, Header } from '@nestjs/common';
import { MetricsService } from './metrics.service';

/** §6.1 — the Prometheus scrape endpoint. No auth: the app has no inbound ports (§7). */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain')
  async get(): Promise<string> {
    return this.metrics.registry.metrics();
  }
}

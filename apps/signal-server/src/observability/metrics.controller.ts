import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { MetricsService } from './metrics.service';

/** Prometheus scrape endpoint — public, it is for the infrastructure (backtest-app-system-design.md §7.1). */
@Public()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain')
  async get(): Promise<string> {
    return this.metrics.registry.metrics();
  }
}

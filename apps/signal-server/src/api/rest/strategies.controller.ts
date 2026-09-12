import { Controller, Get } from '@nestjs/common';
import { StrategiesResponse } from '@trade-automation/contracts';
import { StrategyRunnerService } from '../../strategy-engine/strategy-runner.service';

/** architecture/live-signal-server.md §3.5 — GET /api/strategies. */
@Controller('api/strategies')
export class StrategiesController {
  constructor(private readonly runner: StrategyRunnerService) {}

  @Get()
  list(): StrategiesResponse {
    return this.runner.statuses();
  }
}

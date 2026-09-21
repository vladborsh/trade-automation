import { Controller, Get, Param, UnauthorizedException } from '@nestjs/common';
import { SessionStatsResponse, User } from '@trade-automation/contracts';
import { CurrentUser } from '../../../auth/current-user.decorator';
import { StatsService } from '../../../backtest/stats.service';

/**
 * architecture/backtest-app-system-design.md §7.2 — GET /api/backtest/sessions/:id/stats, the
 * recompute-vs-stored drift check (decision 38). Authenticated by the global AuthGuard; scoped to
 * the cookie user.
 */
@Controller('api/backtest/sessions/:id/stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get()
  get(@CurrentUser() user: User | undefined, @Param('id') id: string): Promise<SessionStatsResponse> {
    this.stats.assertEnabled();
    if (!user) throw new UnauthorizedException('authentication required');
    return this.stats.get(user.id, id);
  }
}

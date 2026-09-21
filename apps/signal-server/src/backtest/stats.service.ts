import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { SessionAggregatesSchema, SessionStatsResponse } from '@trade-automation/contracts';
import { computeStats, toSessionAggregates } from '@trade-automation/replay-core';
import { SessionService } from './session.service';
import { BACKTEST_REPOSITORIES, BacktestRepositories } from './session.repository.port';
import { aggregateDrift } from './stats-drift';

/**
 * architecture/backtest-app-system-design.md §7.2, §8, decision 38 — GET …/stats: the full
 * recompute from the orders table next to what the session row stores.
 *
 * - `computed` = `computeStats` over every closed order of the session;
 * - `stored` = the aggregate columns as they are on the row (T-018 ruling);
 * - `drift` = `toSessionAggregates(computed)` differs from `stored` on any field after rounding
 *   both to the column scale (`aggregateDrift`).
 *
 * Detection only: a drifted row is logged at `warn` (session id and field names, nothing else) and
 * left as it is. Scoped to the cookie user through `SessionService.get` (another user's session is
 * a 404).
 */
@Injectable()
export class StatsService {
  private readonly logger = new Logger(StatsService.name);

  constructor(
    @Inject(BACKTEST_REPOSITORIES) private readonly repos: BacktestRepositories | null,
    private readonly sessions: SessionService,
  ) {}

  async get(userId: string, sessionId: string): Promise<SessionStatsResponse> {
    const repos = this.requireEnabled();
    const session = await this.sessions.get(userId, sessionId);
    const computed = computeStats(await repos.orders.listClosedForStats(session.id), session.initialBalance, session.periodFromMs);
    const stored = SessionAggregatesSchema.parse(session);
    const drifted = aggregateDrift(toSessionAggregates(computed, null), stored);
    if (drifted.length > 0) {
      this.logger.warn(`stats drift on session ${session.id}: ${drifted.join(', ')}`);
    }
    return { computed, stored, drift: drifted.length > 0 };
  }

  /** 503 when the DB module is disabled. */
  assertEnabled(): void {
    this.requireEnabled();
  }

  private requireEnabled(): BacktestRepositories {
    if (!this.repos) throw new ServiceUnavailableException('backtest disabled: DATABASE_URL not set');
    return this.repos;
  }
}

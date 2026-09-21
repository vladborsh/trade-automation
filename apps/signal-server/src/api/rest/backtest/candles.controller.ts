import { BadRequestException, Controller, Get, HttpStatus, Param, Query, UnauthorizedException } from '@nestjs/common';
import {
  AheadQuery,
  AheadQuerySchema,
  AheadResponse,
  InstrumentId,
  ReplayHistoryQuery,
  ReplayHistoryQuerySchema,
  ReplayHistoryResponse,
  SessionSummary,
  User,
} from '@trade-automation/contracts';
import { apiError } from '../../../auth/auth-error';
import { CurrentUser } from '../../../auth/current-user.decorator';
import { ReplayAheadService } from '../../../backtest/replay-ahead.service';
import { ReplayHistoryService } from '../../../backtest/replay-history.service';
import { SessionService } from '../../../backtest/session.service';
import { ZodValidationPipe } from '../../zod-validation.pipe';

/**
 * architecture/backtest-app-system-design.md §5, §7.2 — replay candles for one panel of a
 * session. The session resolves through `SessionService.get` (cookie user; another user's
 * session is a 404). An unknown `panelId` is a 400 like any malformed query.
 */
@Controller('api/backtest/sessions/:id/candles')
export class BacktestCandlesController {
  constructor(
    private readonly sessions: SessionService,
    private readonly history: ReplayHistoryService,
    private readonly aheadService: ReplayAheadService,
  ) {}

  /** History behind the cursor: `before > cursor_ms` is 422 `FUTURE_REQUESTED`. */
  @Get()
  async candles(
    @CurrentUser() user: User | undefined,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(ReplayHistoryQuerySchema)) query: ReplayHistoryQuery,
  ): Promise<ReplayHistoryResponse> {
    const session = await this.sessions.get(this.ownerId(user), id);
    const instrument = panelInstrument(session, query.panelId);
    if (query.before > session.cursorMs) {
      throw apiError(HttpStatus.UNPROCESSABLE_ENTITY, 'FUTURE_REQUESTED', 'History is served only up to the session cursor.');
    }
    return this.history.history(instrument, query.timeframe, query.before, query.limit);
  }

  /** 1m ahead of `fromMs`, clamped to the period; deliberately not bounded by the cursor (§5.3). */
  @Get('ahead')
  async ahead(
    @CurrentUser() user: User | undefined,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(AheadQuerySchema)) query: AheadQuery,
  ): Promise<AheadResponse> {
    const session = await this.sessions.get(this.ownerId(user), id);
    const instrument = panelInstrument(session, query.panelId);
    return this.aheadService.ahead(instrument, query.fromMs, query.limit, session.periodToMs);
  }

  /** 503 without a DB (the guard is then a pass-through and there is no user); otherwise the cookie user. */
  private ownerId(user: User | undefined): string {
    this.sessions.assertEnabled();
    if (!user) throw new UnauthorizedException('authentication required');
    return user.id;
  }
}

function panelInstrument(session: SessionSummary, panelId: string): InstrumentId {
  const panel = session.layout.panels.find((p) => p.id === panelId);
  if (!panel) throw new BadRequestException(`Unknown panelId '${panelId}' for this session.`);
  return panel.instrument;
}

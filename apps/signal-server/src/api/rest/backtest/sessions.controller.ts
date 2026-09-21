import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UnauthorizedException } from '@nestjs/common';
import {
  PatchSessionRequest,
  PatchSessionRequestSchema,
  Session,
  SessionDetail,
  SessionSummariesResponse,
  User,
} from '@trade-automation/contracts';
import { CurrentUser } from '../../../auth/current-user.decorator';
import { SessionService } from '../../../backtest/session.service';
import { ZodValidationPipe } from '../../zod-validation.pipe';

/**
 * architecture/backtest-app-system-design.md §7.2 — /api/backtest/sessions. Authenticated by the
 * global AuthGuard; every call is scoped to the cookie user. POST takes the raw body because the
 * layout codes (422 `LAYOUT_TOO_MANY_PANELS` / `LAYOUT_NOT_CANDLES`) are checked before the
 * contract schema — see `SessionService.create`.
 */
@Controller('api/backtest/sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionService) {}

  @Post()
  create(@CurrentUser() user: User | undefined, @Body() body: unknown): Promise<Session> {
    return this.sessions.create(this.ownerId(user), body);
  }

  @Get()
  list(@CurrentUser() user: User | undefined): Promise<SessionSummariesResponse> {
    return this.sessions.list(this.ownerId(user));
  }

  @Get(':id')
  detail(@CurrentUser() user: User | undefined, @Param('id') id: string): Promise<SessionDetail> {
    return this.sessions.detail(this.ownerId(user), id);
  }

  @Patch(':id')
  patch(
    @CurrentUser() user: User | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PatchSessionRequestSchema)) body: PatchSessionRequest,
  ): Promise<Session> {
    return this.sessions.patch(this.ownerId(user), id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@CurrentUser() user: User | undefined, @Param('id') id: string): Promise<void> {
    return this.sessions.delete(this.ownerId(user), id);
  }

  /** 503 without a DB (the guard is then a pass-through and there is no user); otherwise the cookie user. */
  private ownerId(user: User | undefined): string {
    this.sessions.assertEnabled();
    if (!user) throw new UnauthorizedException('authentication required');
    return user.id;
  }
}

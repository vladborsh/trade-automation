import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import {
  AcceptInviteRequest,
  AcceptInviteRequestSchema,
  AcceptInviteResponse,
  InviteInfo,
  LoginRequest,
  LoginRequestSchema,
  LoginResponse,
  MeResponse,
  User,
} from '@trade-automation/contracts';
import { AuthHttpRequest, AuthHttpResponse, headerValue } from '../../auth/auth-request';
import { AuthService } from '../../auth/auth.service';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Public } from '../../auth/public.decorator';
import { readSessionToken } from '../../auth/session-cookie';
import { ZodValidationPipe } from '../zod-validation.pipe';

/**
 * architecture/backtest-app-system-design.md §7.1 — /api/auth/*. Without `DATABASE_URL` every
 * route here answers 503 (`AuthService.requireEnabled`); the guard is then a pass-through, so
 * `me`/`logout` reach the service and get the same 503.
 */
@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(LoginRequestSchema)) body: LoginRequest,
    @Req() req: AuthHttpRequest,
    @Res({ passthrough: true }) res: AuthHttpResponse,
  ): Promise<LoginResponse> {
    const session = await this.auth.login(body.email, body.password, headerValue(req, 'user-agent') ?? null);
    res.setHeader('Set-Cookie', this.auth.sessionCookie(session));
    return { user: session.user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: AuthHttpRequest, @Res({ passthrough: true }) res: AuthHttpResponse): Promise<void> {
    this.auth.assertEnabled();
    const token = readSessionToken(headerValue(req, 'cookie'));
    if (token) await this.auth.logout(token);
    res.setHeader('Set-Cookie', this.auth.clearedSessionCookie());
  }

  @Get('me')
  me(@CurrentUser() user: User | undefined): MeResponse {
    this.auth.assertEnabled();
    if (!user) throw new UnauthorizedException('authentication required');
    return { user };
  }

  @Public()
  @Get('invites/:token')
  invite(@Param('token') token: string): Promise<InviteInfo> {
    return this.auth.inviteInfo(token);
  }

  @Public()
  @Post('invites/:token/accept')
  async acceptInvite(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(AcceptInviteRequestSchema)) body: AcceptInviteRequest,
    @Req() req: AuthHttpRequest,
    @Res({ passthrough: true }) res: AuthHttpResponse,
  ): Promise<AcceptInviteResponse> {
    const session = await this.auth.acceptInvite(token, body.email, body.password, headerValue(req, 'user-agent') ?? null);
    res.setHeader('Set-Cookie', this.auth.sessionCookie(session));
    return { user: session.user };
  }
}

import { Body, Controller, Get, HttpCode, HttpException, Logger, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  WebChangePasswordRequestSchema, WebLoginRequestSchema, WebSetCredentialsRequestSchema,
  type WebAuthContext, type WebCredentialsInfoResponse, type WebLoginResponse, type WebMeResponse, type WebUser,
} from '@trade-automation/contracts';
import type { User } from '../../users/user.model';
import { clientIp } from './client-ip';
import { CredentialsService, type RequestMeta } from './credentials.service';
import { WebAuthService } from './web-auth.service';
import { CurrentUser, Public } from './web-auth.guard';
import { serializeClearedSessionCookie, serializeSessionCookie, sessionTokenFromCookies, sha256Hex } from './session-cookie';

/** Only what the browser needs — never the deposit, the chat id or the invite chain. */
export const toWebUser = (u: User, login: string | null): WebUser => ({
  id: u.id, tgUserId: u.tgUserId, role: u.role, lang: u.lang, login,
});

/**
 * IB-029 / IB-078 — `/api/web/auth` (architecture/password-login-design-2026-11-02.md §3).
 *
 * Every body is parsed here and only its parsed fields go on; the password is handed to
 * `CredentialsService` and to nothing else — never to a log line or an exception message. A body that
 * does not parse answers the same code a wrong value would (401 / 422), not a 400 that hints at the
 * rule.
 */
@Controller('api/web/auth')
export class WebAuthController {
  private readonly logger = new Logger(WebAuthController.name);
  private warnedNoIpHeader = false;

  constructor(
    private readonly auth: WebAuthService,
    private readonly credentials: CredentialsService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<WebLoginResponse> {
    const parsed = WebLoginRequestSchema.safeParse(body);
    if (!parsed.success) throw new HttpException({ code: 'INVALID_CREDENTIALS' }, 401);

    const result = await this.credentials.login(parsed.data.login, parsed.data.password, this.meta(req));
    if (!result.ok) throw new HttpException({ code: result.code }, result.status);

    res.setHeader('Set-Cookie', serializeSessionCookie(result.token, result.expiresAtMs, { secure: this.auth.cookieSecure }));
    return { user: toWebUser(result.user, result.login) };
  }

  /** Whether the set-password page asks for a login. Does NOT spend the token. */
  @Public()
  @Get('credentials')
  async credentialsInfo(@Query('t') t: unknown): Promise<WebCredentialsInfoResponse> {
    if (typeof t !== 'string' || t.length === 0 || t.length > 256) throw new HttpException({ code: 'TOKEN_INVALID' }, 401);
    const info = await this.credentials.credentialsInfo(t);
    if (!info.ok) throw new HttpException({ code: info.code }, info.status);
    return info.hasLogin ? { hasLogin: true, login: info.login } : { hasLogin: false };
  }

  /** Sets up or resets the password. 204 and NO cookie: the person then signs in on /login (P1). */
  @Public()
  @Post('credentials')
  @HttpCode(204)
  async setCredentials(@Body() body: unknown, @Req() req: Request): Promise<void> {
    const parsed = WebSetCredentialsRequestSchema.safeParse(body);
    if (!parsed.success) throw new HttpException({ code: 'TOKEN_INVALID' }, 401);
    const result = await this.credentials.setCredentials(parsed.data.token, parsed.data.login, parsed.data.password, this.meta(req));
    if (!result.ok) throw new HttpException({ code: result.code }, result.status);
  }

  /** P9: change while signed in — every OTHER session ends, this one stays. */
  @Post('password')
  @HttpCode(204)
  async changePassword(@CurrentUser() user: User, @Body() body: unknown, @Req() req: Request): Promise<void> {
    const parsed = WebChangePasswordRequestSchema.safeParse(body);
    if (!parsed.success) throw new HttpException({ code: 'INVALID_CREDENTIALS' }, 401);
    const token = sessionTokenFromCookies(req.headers.cookie) as string; // the guard let us in with it
    const result = await this.credentials.changePassword(user, sha256Hex(token), parsed.data.current, parsed.data.next, this.meta(req));
    if (!result.ok) throw new HttpException({ code: result.code }, result.status);
  }

  /** P9: every session of the member, this one included, and the browser's cookie. */
  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(@CurrentUser() user: User, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.credentials.logoutAll(user, this.meta(req));
    res.setHeader('Set-Cookie', serializeClearedSessionCookie({ secure: this.auth.cookieSecure }));
  }

  /**
   * IB-BUG-008 — the login screen tells the visitor which bot to message (for `/password`), and the
   * username is configuration (`TELEGRAM_BOT_USERNAME`), never hard-coded. Public by design.
   */
  @Public()
  @Get('context')
  context(): WebAuthContext {
    return { botUsername: this.auth.botUsername };
  }

  @Get('me')
  async me(@CurrentUser() user: User): Promise<WebMeResponse> {
    return { user: toWebUser(user, await this.credentials.loginOf(user.id)) };
  }

  /**
   * Deletes the session row and clears the cookie. Public on purpose: logging out with an
   * already-dead cookie must still clear the browser's copy rather than answer 401.
   */
  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = sessionTokenFromCookies(req.headers.cookie);
    if (token) await this.auth.logout(token);
    res.setHeader('Set-Cookie', serializeClearedSessionCookie({ secure: this.auth.cookieSecure }));
  }

  private meta(req: Request): RequestMeta {
    const found = clientIp({ headers: req.headers, socketAddress: req.socket?.remoteAddress }, this.auth.clientIpHeader);
    if (found.fellBack && !this.warnedNoIpHeader) {
      this.warnedNoIpHeader = true;
      this.logger.warn(`CLIENT_IP_HEADER=${this.auth.clientIpHeader} is set but a request arrived without it; using the socket address (logged once)`);
    }
    const ua = req.headers['user-agent'];
    return { ip: found.ip, userAgent: typeof ua === 'string' ? ua : null };
  }
}

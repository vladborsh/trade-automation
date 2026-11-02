import { Body, Controller, Get, HttpCode, HttpException, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  WebExchangeRequestSchema, WebTelegramLoginRequestSchema, type WebAuthContext, type WebExchangeResponse,
  type WebMeResponse, type WebTelegramLoginResponse, type WebUser,
} from '@trade-automation/contracts';
import type { User } from '../../users/user.model';
import { WebAuthService } from './web-auth.service';
import { CurrentUser, Public } from './web-auth.guard';
import { serializeClearedSessionCookie, serializeSessionCookie, sessionTokenFromCookies } from './session-cookie';

/** Only what the browser needs — never the deposit, the chat id or the invite chain. */
// IB-078 step 1 (contracts): `login: null` until web_credentials exists; the credentials commit fills it.
const toWebUser = (u: User): WebUser => ({ id: u.id, tgUserId: u.tgUserId, role: u.role, lang: u.lang, login: null });

/**
 * IB-029 — `/api/web/auth` (architecture/insight-bot-web-dashboard.md §4).
 */
@Controller('api/web/auth')
export class WebAuthController {
  constructor(private readonly auth: WebAuthService) {}

  /** The only public route: the browser arrives here holding a link token and no cookie. */
  @Public()
  @Post('exchange')
  @HttpCode(200)
  async exchange(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<WebExchangeResponse> {
    const parsed = WebExchangeRequestSchema.safeParse(body);
    if (!parsed.success) throw new HttpException({ code: 'TOKEN_INVALID' }, 401);

    const result = await this.auth.exchange(parsed.data.token);
    if (!result.ok) throw new HttpException({ code: result.code }, result.status);

    res.setHeader('Set-Cookie', serializeSessionCookie(result.token, result.expiresAtMs, { secure: this.auth.cookieSecure }));
    return { user: toWebUser(result.user) };
  }

  /**
   * IB-072 — "Log in with Telegram": the widget's signed payload, as the browser received it.
   * Same cookie, same session row as `exchange` (both go through `WebAuthService.openSession`).
   * The 503 comes first so a server without `TELEGRAM_BOT_TOKEN` says so rather than "invalid".
   */
  @Public()
  @Post('telegram')
  @HttpCode(200)
  async telegram(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<WebTelegramLoginResponse> {
    if (!this.auth.telegramLoginAvailable) throw new HttpException({ code: 'TELEGRAM_LOGIN_UNAVAILABLE' }, 503);
    const parsed = WebTelegramLoginRequestSchema.safeParse(body);
    if (!parsed.success) throw new HttpException({ code: 'TOKEN_INVALID' }, 401);

    const result = await this.auth.loginWithTelegram(parsed.data);
    if (!result.ok) throw new HttpException({ code: result.code }, result.status);

    res.setHeader('Set-Cookie', serializeSessionCookie(result.token, result.expiresAtMs, { secure: this.auth.cookieSecure }));
    return { user: toWebUser(result.user) };
  }

  /**
   * IB-BUG-008 — the login screen tells the visitor which bot to message, and the username is
   * configuration (`TELEGRAM_BOT_USERNAME`), never hard-coded. Public, because the whole point
   * is that it is readable by someone who has no session yet; it carries nothing else.
   */
  @Public()
  @Get('context')
  context(): WebAuthContext {
    return { botUsername: this.auth.botUsername };
  }

  @Get('me')
  me(@CurrentUser() user: User): WebMeResponse {
    return { user: toWebUser(user) };
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
}

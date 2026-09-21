import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthHttpRequest, AuthHttpResponse, headerValue } from './auth-request';
import { AuthService } from './auth.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { readSessionToken } from './session-cookie';

/**
 * architecture/backtest-app-system-design.md §7.1, D7 — registered as the global `APP_GUARD`, so
 * every REST route requires a valid `bt_session` cookie unless marked `@Public()`. Slides the
 * session's expiry (and re-sends the cookie) when it is more than an hour since last seen.
 *
 * Pass-through when the DB module is disabled (no `DATABASE_URL`): the pre-auth dev/mock setup
 * keeps working unchanged, and the auth routes themselves answer 503.
 *
 * WS message handlers are not guarded here: the WS gateway authenticates once, on connection.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    if (!this.auth.enabled) return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthHttpRequest>();
    const token = readSessionToken(headerValue(request, 'cookie'));
    const result = token ? await this.auth.authenticate(token) : null;
    if (!result) throw new UnauthorizedException('authentication required');

    request.user = result.user;
    if (result.refreshedExpiresAtMs !== null && token) {
      const response = context.switchToHttp().getResponse<AuthHttpResponse>();
      response.setHeader('Set-Cookie', this.auth.sessionCookie({ token, expiresAtMs: result.refreshedExpiresAtMs }));
    }
    return true;
  }
}

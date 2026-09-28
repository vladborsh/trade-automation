import {
  CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable,
  SetMetadata, UnauthorizedException, type ExecutionContext as Ctx,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import type { User } from '../../users/user.model';
import { WebAuthService } from './web-auth.service';
import { serializeSessionCookie, sessionTokenFromCookies } from './session-cookie';

/**
 * IB-029 — the cookie guard for `/api/web/*` (§4).
 *
 * Attaches the member to the request, and — because the guard is the only place that sees every
 * authenticated request — this is where the sliding expiry is renewed: if the session was last
 * seen over an hour ago, the guard both extends the row and re-sends the cookie, so an active
 * member's 30 days never lapse under them.
 */

export const ADMIN_ONLY_KEY = 'ib:adminOnly';
/** Marks a route as admin-only; the guard enforces it after authentication. */
export const AdminOnly = (): MethodDecorator & ClassDecorator => SetMetadata(ADMIN_ONLY_KEY, true);

/** Marks a route as public — only the exchange endpoint, which has no cookie yet. */
export const PUBLIC_KEY = 'ib:public';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_KEY, true);

/** Only what the guard needs; avoids coupling to a specific express typing. */
export interface RequestWithUser {
  headers: Record<string, string | string[] | undefined>;
  url?: string;
  originalUrl?: string;
  ibUser?: User;
}

/** The guard is registered app-wide but enforces only the dashboard's own surface. */
export const WEB_API_PREFIX = '/api/web';

/** `@CurrentUser()` — the authenticated member, guaranteed present on a guarded route. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: Ctx): User => {
  const request = ctx.switchToHttp().getRequest<RequestWithUser>();
  if (!request.ibUser) throw new UnauthorizedException({ code: 'UNAUTHENTICATED' });
  return request.ibUser;
});

@Injectable()
export class WebAuthGuard implements CanActivate {
  constructor(
    private readonly auth: WebAuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const request = context.switchToHttp().getRequest<RequestWithUser>();

    // Registered as an APP_GUARD so every /api/web controller inherits it without repeating a
    // decorator (Tech Lead's ruling for IB-030's controllers). Everything OUTSIDE /api/web —
    // the unauthenticated ops /health and /metrics — is left alone.
    const path = (request.originalUrl ?? request.url ?? '').split('?')[0];
    if (!path.startsWith(WEB_API_PREFIX)) return true;

    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const cookie = request.headers.cookie;
    const token = sessionTokenFromCookies(typeof cookie === 'string' ? cookie : undefined);
    if (!token) throw new UnauthorizedException({ code: 'UNAUTHENTICATED' });

    const resolved = await this.auth.resolveSession(token);
    if (!resolved) throw new UnauthorizedException({ code: 'UNAUTHENTICATED' });

    if (resolved.refreshedExpiresAtMs !== undefined) {
      const response = context.switchToHttp().getResponse<Response>();
      response.setHeader('Set-Cookie', serializeSessionCookie(token, resolved.refreshedExpiresAtMs, { secure: this.auth.cookieSecure }));
    }

    request.ibUser = resolved.user;

    if (this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY_KEY, targets) && resolved.user.role !== 'admin') {
      throw new ForbiddenException({ code: 'FORBIDDEN' });
    }
    return true;
  }
}

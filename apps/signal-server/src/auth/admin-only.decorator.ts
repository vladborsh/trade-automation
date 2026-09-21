import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UseGuards, applyDecorators } from '@nestjs/common';
import { AuthHttpRequest } from './auth-request';
import { AuthService } from './auth.service';

/**
 * architecture/backtest-app-system-design.md §7.1 — "admin" = auth + `role='admin'`. Runs after
 * the global `AuthGuard` (Nest evaluates global guards first), so the request already carries
 * the cookie user. A signed-in non-admin gets a plain 403: the contract has no error code for it.
 * Without a DB this is a pass-through, like `AuthGuard`, and the admin routes answer 503.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.auth.enabled) return true;
    const user = context.switchToHttp().getRequest<AuthHttpRequest>().user;
    if (user?.role !== 'admin') throw new ForbiddenException('admin only');
    return true;
  }
}

/** Restricts a controller or route to `role='admin'` (on top of the global AuthGuard). */
export const AdminOnly = () => applyDecorators(UseGuards(AdminGuard));

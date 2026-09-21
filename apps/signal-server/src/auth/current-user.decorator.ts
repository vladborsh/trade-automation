import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { User } from '@trade-automation/contracts';
import { AuthHttpRequest } from './auth-request';

/**
 * The authenticated user `AuthGuard` attached to the request. `undefined` on a `@Public()` route
 * and whenever the DB module is disabled (the guard is then a pass-through).
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User | undefined => ctx.switchToHttp().getRequest<AuthHttpRequest>().user,
);

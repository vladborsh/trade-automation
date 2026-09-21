import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';

/**
 * architecture/backtest-app-system-design.md D7 — the explicit allow-list for the global
 * `AuthGuard`: login, the invite endpoints, `/api/health` and the Prometheus `/metrics`.
 * Everything else requires a valid `bt_session` cookie.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

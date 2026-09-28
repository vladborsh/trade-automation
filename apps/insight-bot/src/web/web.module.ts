import { Module, type DynamicModule, Logger } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppConfigModule } from '../config/config.module';
import { DbModule } from '../db/db.module';
import { WebAuthController } from './auth/web-auth.controller';
import { WebAuthGuard } from './auth/web-auth.guard';
import { WebAuthService } from './auth/web-auth.service';

/**
 * IB-029 — the dashboard's server surface (architecture/insight-bot-web-dashboard.md §4).
 *
 * **The guard is module-wide, not per-controller** (Tech Lead's ruling): it is registered as an
 * `APP_GUARD` and enforces on the `/api/web` prefix, so every controller added here later —
 * IB-030's `health.ts` and `coverage.ts`, and the pages after them — is authenticated by
 * default and nobody has to remember a decorator. Routes outside `/api/web`, including the
 * unauthenticated ops `/health` and `/metrics`, are untouched by it.
 *
 * Opting a route out is explicit and rare: `@Public()` (the token exchange, which arrives
 * without a cookie, and logout, which must clear a dead cookie rather than 401).
 *
 * Registered only when there is a database, like the other feature modules: sessions are rows.
 */
@Module({})
export class WebModule {
  static register(): DynamicModule {
    const enabled = typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.length > 0;
    if (!enabled) {
      new Logger(WebModule.name).warn('DATABASE_URL is not set — the web dashboard API is disabled');
      return { module: WebModule };
    }
    return {
      module: WebModule,
      imports: [AppConfigModule, DbModule],
      controllers: [WebAuthController],
      providers: [WebAuthService, { provide: APP_GUARD, useClass: WebAuthGuard }],
      exports: [WebAuthService],
    };
  }
}

import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppConfigModule } from '../config/config.module';
import { DB, Db } from '../db/db.port';
import { DbModule } from '../db/db.module';
import { AdminBootstrap } from './admin-bootstrap.service';
import { AUTH_REPOSITORIES } from './auth-repositories.port';
import { AuthGuard } from './auth.guard';
import { AUTH_CLOCK, AuthService } from './auth.service';
import { LoginThrottle } from './login-throttle';
import { PasswordHasher } from './password';
import { PgAuthRepositories } from './pg/pg-auth-repositories';

/**
 * architecture/backtest-app-system-design.md §2.2 `auth/`. Registers `AuthGuard` as the global
 * `APP_GUARD`. `AUTH_REPOSITORIES` is null when `DB` is (no `DATABASE_URL`).
 */
@Module({
  imports: [AppConfigModule, DbModule],
  providers: [
    { provide: AUTH_REPOSITORIES, inject: [DB], useFactory: (db: Db | null) => (db ? new PgAuthRepositories(db) : null) },
    { provide: PasswordHasher, useFactory: () => new PasswordHasher() },
    { provide: LoginThrottle, useFactory: () => new LoginThrottle() },
    { provide: AUTH_CLOCK, useValue: () => Date.now() },
    AuthService,
    AdminBootstrap,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}

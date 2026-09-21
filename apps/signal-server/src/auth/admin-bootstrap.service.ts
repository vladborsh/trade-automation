import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { AcceptInviteRequestSchema } from '@trade-automation/contracts';
import { AppConfigService } from '../config/config.service';
import { AUTH_REPOSITORIES, AuthRepositories } from './auth-repositories.port';
import { PasswordHasher } from './password';

/**
 * architecture/backtest-app-system-design.md §2.2, D7, brief decision 20 — the admin is never
 * created through the UI: at boot, `ADMIN_EMAIL`/`ADMIN_PASSWORD` are upserted as an enabled
 * `role='admin'` user. Runs on application bootstrap, i.e. after `DbModule` has migrated.
 *
 * No DB → nothing to do. DB but no admin env → a warning (the app works, nobody can log in
 * until an admin exists). A password shorter than the policy's 10 characters is a boot failure,
 * like any other invalid config.
 */
@Injectable()
export class AdminBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrap.name);

  constructor(
    @Inject(AUTH_REPOSITORIES) private readonly repos: AuthRepositories | null,
    private readonly hasher: PasswordHasher,
    private readonly config: AppConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.repos) return;
    const email = this.config.env.get('ADMIN_EMAIL');
    const password = this.config.env.get('ADMIN_PASSWORD');
    if (!email || !password) {
      this.logger.warn('ADMIN_EMAIL/ADMIN_PASSWORD not set — no admin account bootstrapped.');
      return;
    }
    const parsed = AcceptInviteRequestSchema.safeParse({ email, password });
    if (!parsed.success) {
      throw new Error(
        'ADMIN_EMAIL must be an email and ADMIN_PASSWORD at least 10 characters (architecture/backtest-app-system-design.md §7.1).',
      );
    }
    const admin = await this.repos.users.upsertAdmin(parsed.data.email, await this.hasher.hash(parsed.data.password));
    this.logger.log(`Admin account bootstrapped from env: ${admin.email}`);
  }
}

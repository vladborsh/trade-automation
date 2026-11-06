import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { Bot } from 'grammy';
import { AppConfigService } from '../config/config.service';
import { UsersService } from '../users/users.service';
import { WebAuthService } from '../web/auth/web-auth.service';
import { CredentialsService } from '../web/auth/credentials.service';
import { LOGIN_TOKEN_TTL_MS } from '../web/auth/session-cookie';
import { registerHandlers } from './bot-handlers';
import { DB, type Db } from '../db/db.port';
import { PgOiAlertsVisibility } from '../alerts/oi-divergence/pg/oi-alerts.repo';
import { CustomLevels } from '../alerts/levels/custom-levels';
import { PgCustomLevelStore } from '../alerts/levels/pg/custom-levels.repo';

/**
 * IB-021 — the member bot (design §8.6, D11): grammY **long polling**, so the instance opens no
 * inbound port.
 *
 * **Without `TELEGRAM_BOT_TOKEN` the bot does not start** — it is disabled, not broken, exactly
 * as IB-011's sender is. The tokens are the user's to issue (one production bot, one test bot
 * per slot); an agent must never register one. Everything below is therefore built and specced
 * with the bot switched off, and a real token is the only thing between this and a live run.
 */
@Injectable()
export class TelegramBotService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private bot: Bot | null = null;

  constructor(
    private readonly config: AppConfigService,
    private readonly users: UsersService,
    private readonly webAuth: WebAuthService,
    private readonly credentials: CredentialsService,
    @Optional() @Inject(DB) private readonly db?: Db | null,
  ) {}

  get enabled(): boolean {
    return this.bot !== null;
  }

  onApplicationBootstrap(): void {
    const token = this.config.env.get('TELEGRAM_BOT_TOKEN');
    if (typeof token !== 'string' || token.length === 0) {
      this.logger.warn('TELEGRAM_BOT_TOKEN is not set — the member bot is disabled (the app still collects and serves /healthz)');
      return;
    }

    const bot = new Bot(token);
    registerHandlers(bot, {
      users: this.users,
      web: {
        createCredentialsLink: (userId) => this.credentials.createCredentialsLink(userId),
        hasCredentials: (userId) => this.credentials.hasCredentials(userId),
        siteUrl: this.webAuth.webBaseUrl,
        loginTokenTtlMs: LOGIN_TOKEN_TTL_MS,
      },
      botUsername: this.config.env.get('TELEGRAM_BOT_USERNAME'),
      // IB-112 (V13): /oialerts is shown to members only while the admin page's members_visible is on
      ...(this.db ? { oiAlerts: new PgOiAlertsVisibility(this.db) } : {}),
      // IB-128 (P9): /level for admins — the same service as /admin/alerts
      ...(this.db ? { customLevels: new CustomLevels(new PgCustomLevelStore(this.db)) } : {}),
      logger: { warn: (m) => this.logger.warn(m) },
    });

    // A handler that throws must not take the polling loop down with it: one bad update would
    // otherwise silence the bot for everyone until a restart.
    bot.catch((err) => this.logger.error(`bot handler failed on update ${err.ctx?.update?.update_id}: ${err.message}`));

    this.bot = bot;
    // start() resolves only when polling stops, so it is deliberately not awaited here
    void bot.start({ onStart: (info) => this.logger.log(`member bot polling as @${info.username}`) })
      .catch((error) => this.logger.error(`bot polling stopped: ${(error as Error).message}`));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.bot) {
      await this.bot.stop();
      this.bot = null;
    }
  }
}

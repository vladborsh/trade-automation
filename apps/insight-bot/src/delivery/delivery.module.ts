import { Logger, Module, type DynamicModule } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { DbModule } from '../db/db.module';
import { UsersService } from '../users/users.service';
import { CalendarNotifierService } from './calendar-notifier.service';
import { TelegramSender } from './telegram-sender';
import { TelegramBotService } from './telegram-bot.service';
import { WebModule } from '../web/web.module';

/**
 * IB-021 — the Telegram surface: the member bot (§8.6) and IB-011's service-chat sender, which
 * now lives here rather than in `ops/`.
 *
 * Registered only when there is a database, the same switch `CollectorsModule` uses: users and
 * invites are rows, and a bot that cannot read its own members would answer everyone "this bot
 * is private".
 */
@Module({})
export class DeliveryModule {
  static register(): DynamicModule {
    const enabled = typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.length > 0;
    if (!enabled) {
      new Logger(DeliveryModule.name).warn('DATABASE_URL is not set — the member bot is disabled');
      return { module: DeliveryModule };
    }
    return {
      module: DeliveryModule,
      imports: [AppConfigModule, DbModule, WebModule.register()],
      // IB-062: the calendar DMs live here, beside the bot, because they need the sender and users
      providers: [UsersService, TelegramSender, TelegramBotService, CalendarNotifierService],
      exports: [UsersService, TelegramSender],
    };
  }
}

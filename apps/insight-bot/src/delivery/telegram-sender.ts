import { Injectable, Logger } from '@nestjs/common';
import { Bot } from 'grammy';
import { AppConfigService } from '../config/config.service';

/**
 * IB-011 — the service-chat sender (design §6.2, §8.6).
 *
 * Deliberately minimal: **send only**, no commands, no polling loop. IB-021 builds the member bot
 * with grammY's long polling; this is the operator channel for watchdog alerts and the daily gap
 * report, and nothing else should grow here.
 *
 * **Without a token it is disabled, not broken.** `TELEGRAM_BOT_TOKEN` and
 * `TELEGRAM_SERVICE_CHAT_ID` are the user's to supply (AGENTS.md: tokens are never registered or
 * invented by an agent). With either missing, `send()` logs the message at warn level and returns
 * false, so a dev slot and the specs run the whole watchdog and report path with no bot at all.
 */
@Injectable()
export class TelegramSender {
  private readonly logger = new Logger(TelegramSender.name);
  private readonly bot: Bot | null;
  private readonly chatId: string | null;
  private failures = 0;

  constructor(config: AppConfigService) {
    const token = config.env.get('TELEGRAM_BOT_TOKEN');
    const chatId = config.env.get('TELEGRAM_SERVICE_CHAT_ID');
    this.chatId = typeof chatId === 'string' && chatId.length > 0 ? chatId : null;
    this.bot = typeof token === 'string' && token.length > 0 ? new Bot(token) : null;
    if (!this.enabled) {
      this.logger.warn(
        'Telegram is not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_SERVICE_CHAT_ID) — ' +
          'watchdog alerts will be logged instead of sent',
      );
    }
  }

  get enabled(): boolean {
    return this.bot !== null && this.chatId !== null;
  }

  /**
   * Sends one message. Never throws: an operator channel that can take the process down with it
   * is worse than one that misses a message; what the watchdog alerts on is also in
   * `collector_gaps` and on the admin health page.
   */
  async send(text: string): Promise<boolean> {
    if (!this.enabled) {
      this.logger.warn(`[service chat, not sent] ${text}`);
      return false;
    }
    return this.deliver(this.chatId as string, text);
  }

  /**
   * IB-062 — one message to a member's own chat (the calendar digest and reminders). Needs only
   * the token, not the service chat. Never throws, for the same reason as `send`: a member who
   * blocked the bot must not stop the next member's reminder.
   */
  async sendTo(chatId: number | string, text: string): Promise<boolean> {
    if (this.bot === null) {
      this.logger.warn(`[chat ${chatId}, not sent: no TELEGRAM_BOT_TOKEN] ${text}`);
      return false;
    }
    return this.deliver(chatId, text);
  }

  private async deliver(chatId: number | string, text: string): Promise<boolean> {
    try {
      await (this.bot as Bot).api.sendMessage(chatId, text, { link_preview_options: { is_disabled: true } });
      this.failures = 0;
      return true;
    } catch (error) {
      this.failures++;
      // Telegram being down must not be louder in the logs than the thing we were reporting.
      const message = (error as Error).message;
      if (this.failures <= 3) this.logger.warn(`Telegram send failed (${this.failures}): ${message}`);
      else if (this.failures % 20 === 0) this.logger.warn(`Telegram send still failing (${this.failures}): ${message}`);
      return false;
    }
  }
}

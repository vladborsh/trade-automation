import TelegramBot from 'node-telegram-bot-api';
import { DynamoDBClient } from './dynamo-db-client';
import { Logger } from 'winston';
import { LogMessageType } from '../../types/enums';
import { injectable } from 'inversify';

@injectable()
export class BotNotifier {

  constructor(
    private readonly telegramBot: TelegramBot,
    private readonly dynamoDBClient: DynamoDBClient,
    private readonly logger: Logger
  ) {}

  public async sendMessageToAll(message: string): Promise<void> {
    try {
      const userStates = await this.dynamoDBClient.getAllUserStates();
      const botUser = await this.telegramBot.getMe();

      for (const userState of userStates) {
        const member = await this.telegramBot.getChatMember(userState.chatId, botUser.id);
        if (member.status === 'member') {
          await this.telegramBot.sendMessage(userState.chatId, message, {
            parse_mode: 'Markdown',
          });
        }
      }
    } catch (e) {
      this.logError(e);
    }
  }

  public async sendPhotoToAll(photo: Buffer, caption?: string): Promise<void> {
    try {
      const userStates = await this.dynamoDBClient.getAllUserStates();
      const botUser = await this.telegramBot.getMe();

      for (const userState of userStates) {
        const member = await this.telegramBot.getChatMember(userState.chatId, botUser.id);
        if (member.status === 'member') {
          await this.telegramBot.sendPhoto(userState.chatId, photo, {
            caption: caption,
            parse_mode: 'Markdown',
          });
        }
      }
    } catch (e) {
      this.logError(e);
    }
  }

  private logError(e: unknown): void {
    this.logger.error({
      type: LogMessageType.BROADCASTING_ERROR,
      message: `Error while broadcasting message to all users: ${e}`,
    });
  }
}

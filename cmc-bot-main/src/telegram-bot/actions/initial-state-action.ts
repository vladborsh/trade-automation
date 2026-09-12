import TelegramBot from 'node-telegram-bot-api';
import { BotCommands, BotStates } from '../../types/enums';
import { BotState } from '../state-machine';

export class InitialStateAction implements BotState {
  public static readonly Key = BotStates.INITIAL;

  constructor(private bot: TelegramBot) {}

  public async onEnter(message: TelegramBot.Message): Promise<void> {
    await this.bot.sendMessage(
      message.chat.id,
      `Hello, I'm Bot. I can help you with cryptocurrency news, charts and watchlists.`
    );
  }
}

import TelegramBot from 'node-telegram-bot-api';
import { BotCommands, BotStates } from '../../types/enums';
import { BotState } from '../state-machine';

export class AskAboutNewsMessageAction implements BotState {
  public static readonly Key = BotStates.LATEST_NEWS;
  constructor(private bot: TelegramBot) {}

  public async onEnter(message: TelegramBot.Message): Promise<void> {
    await this.bot.sendMessage(
      message.chat.id,
      `Do you want to see related to these currencies news?`,
      {
        reply_markup: {
          keyboard: [[{ text: BotCommands.yesShowNews }, { text: BotCommands.noDoNotShowNews }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      }
    );
  }
}

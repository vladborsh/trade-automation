import TelegramBot from 'node-telegram-bot-api';
import { BotCommands, BotStates } from '../../types/enums';
import { BotState } from '../state-machine';

export class CryptoCurrencySortAction implements BotState {
  public static readonly Key = BotStates.CRYPTO_CURRENCY_CHARTS;

  constructor(private bot: TelegramBot) {}

  public async onEnter(message: TelegramBot.Message): Promise<void> {
    await this.bot.sendMessage(message.chat.id, `What sorting do you prefer?`, {
      reply_markup: {
        keyboard: [
          [
            { text: BotCommands.volume24h },
            { text: BotCommands.price7d },
            { text: BotCommands.price24h },
          ],
        ],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
  }
}

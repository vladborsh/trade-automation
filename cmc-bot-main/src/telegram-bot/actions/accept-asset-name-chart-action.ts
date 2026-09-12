import TelegramBot from 'node-telegram-bot-api';
import { BotState } from '../state-machine';

export class AcceptAssetNameChartAction implements BotState {
  constructor(private bot: TelegramBot) {}

  public async onEnter(message: TelegramBot.Message): Promise<void> {
    await this.bot.sendMessage(
      message.chat.id,
      `What crypto do you prefer? Please type space\\-separated text with asset name and timeframe \\(m5, m15, h1, h4\\), like \` btcusdt m5\` or \`gu m15\` \\(gbpusd pair\\)\\. Just just type \`stop\` if you would like back to menu`,
      {
        parse_mode: 'MarkdownV2',
      }
    );
  }
}

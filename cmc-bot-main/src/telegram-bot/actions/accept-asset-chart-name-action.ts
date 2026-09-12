import TelegramBot from 'node-telegram-bot-api';
import { BotStates, BotTransitions } from '../../types/enums';
import { BotState } from '../state-machine';
import { StateMachine } from '@xstate/fsm';

export class AcceptAssetChartNameAction implements BotState {
  public static readonly Key = BotStates.ACCEPT_ASSET_CHART_NAME;

  constructor(
    private bot: TelegramBot,
    private state: StateMachine.Service<any, any>
  ) {}

  public async onEnter(message: TelegramBot.Message): Promise<void> {
    await this.bot.sendMessage(
      message.chat.id,
      `What crypto do you prefer? Please type space\\-separated text with asset name and timeframe \\(m5, m15, h1, h4\\), like \` btcusdt m5\` or \`gu m15\` \\(gbpusd pair\\)\\. Just just type \`stop\` if you would like back to menu`,
      {
        parse_mode: 'MarkdownV2',
      }
    );
    this.state.send(BotTransitions.GET_SELECTED_CRYPTO_CHART);
  }
}

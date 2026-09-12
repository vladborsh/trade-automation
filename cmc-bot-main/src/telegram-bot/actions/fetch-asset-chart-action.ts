import TelegramBot from 'node-telegram-bot-api';
import { validateAssetName } from '../validate-asset-name';
import { EnvConfig } from '../../env-config';
import { DynamicConfig } from '../../utils/dynamic-config';
import { BinanceClient } from '../../core/services/binance-client';
import { ChartCanvasRenderer } from '../../core/services/chart-canvas-renderer';
import { BotStates, BotTransitions } from '../../types/enums';
import { getLinkText } from '../../utils/get-link-text.helper';
import { CapitalComClient } from '../../core/services/capital-com-client';
import { Exchange } from '../../interfaces/user-state.interface';
import { IExchangeClient } from '../../interfaces/exchange-client.interface';
import { ParsedAssetInfo } from '../../interfaces/parsed-asset-info.interface';
import { BotState } from '../state-machine';
import { StateMachine } from '@xstate/fsm';
import { indicatorScript } from '../../indicator/main-indicator';

export class FetchAssetChartStateAction implements BotState {
  public static readonly Key = BotStates.FETCH_ASSET_CHART;

  stringToExchange: Record<Exchange, IExchangeClient> = {
    [Exchange.binance]: this.binanceClient,
    [Exchange.capitalcom]: this.capitalComClient,
  };

  constructor(
    private envConfig: EnvConfig,
    private dynamicConfig: DynamicConfig,
    private binanceClient: BinanceClient,
    private chartCanvasRenderer: ChartCanvasRenderer,
    private capitalComClient: CapitalComClient,
    private bot: TelegramBot,
    private state: StateMachine.Service<any, any>
  ) {}

  public async onEnter(command: TelegramBot.Message): Promise<void> {
    let assetInfo: ParsedAssetInfo;
    if (!command.text) {
      throw new Error(`invalid command: "${command.text}"`);
    }
    try {
      assetInfo = await validateAssetName(command.text.trim(), this.envConfig);
    } catch (e) {
      this.bot.sendMessage(command.chat.id, `Error: ${e?.toString()}`);
      throw new Error(`error: "${e?.toString()}"`);
    }

    const exchangeClient = this.stringToExchange[assetInfo.exchange] || this.binanceClient;
    const dynamicConfigValues = await this.dynamicConfig.getConfig();

    try {
      const candles = await exchangeClient.getCandles(
        assetInfo.asset.toUpperCase(),
        assetInfo.timeFrame,
        dynamicConfigValues.CHART_HISTORY_SIZE
      );

      const img = this.chartCanvasRenderer.generateImage(candles, {});
      await this.bot.sendPhoto(command.chat.id, img, {
        caption: getLinkText(assetInfo.asset, assetInfo.timeFrame, assetInfo.exchange),
        parse_mode: 'MarkdownV2',
      });
    } catch (e) {
      this.bot.sendMessage(command.chat.id, `Error: ${e?.toString()}`);
    }

    this.state.send(BotTransitions.BACK_TO_START);
  }
}

import TelegramBot from 'node-telegram-bot-api';
import { Logger } from 'winston';
import { DynamicConfig } from '../../utils/dynamic-config';
import { EnvConfig } from '../../env-config';
import { DynamoDBClient } from '../../core/services/dynamo-db-client';
import { BinanceClient } from '../../core/services/binance-client';
import { ChartCanvasRenderer } from '../../core/services/chart-canvas-renderer';
import { GeneralTimeIntervals, LogMessageType } from '../../types/enums';
import { BotLogger } from '../../utils/bot-logger';
import { getLinkText } from '../../utils/get-link-text.helper';
import { BotState } from '../state-machine';
import { indicatorScript } from '../../indicator/main-indicator';

export class RenderCryptoChartsAction implements BotState {
  private logger: Logger | undefined;

  constructor(
    private envConfig: EnvConfig,
    private dynamicConfig: DynamicConfig,
    private bot: TelegramBot,
    private dynamoDbClient: DynamoDBClient
  ) {
    this.logger = BotLogger.getInstance(envConfig);
  }

  public async onEnter(message: TelegramBot.Message): Promise<void> {
    const chatId = message.chat.id;
    const savedState = await this.dynamoDbClient.getUserState(chatId);

    if (!savedState?.lastSelectedCrypto) {
      await this.bot.sendMessage(chatId, `Sorry, there is no selected currency, please try again`);
      return;
    }

    const binanceClient = BinanceClient.getInstance(this.envConfig, this.dynamicConfig);

    let count = 0;
    const dynamicConfigValues = await this.dynamicConfig.getConfig();
    const chartCanvasRenderer = new ChartCanvasRenderer(dynamicConfigValues);

    for (let symbol of savedState.lastSelectedCrypto.map(symbol => `${symbol}USDT`)) {
      try {
        if (!(await binanceClient.isSymbolExists(symbol))) {
          continue;
        }
      } catch (e) {
        this.logger?.error({ chatId, type: LogMessageType.UNKNOWN_SYMBOL_ERROR, message: e });
        break;
      }

      try {
        const candles = await binanceClient.getCandles(
          symbol,
          GeneralTimeIntervals.h1,
          dynamicConfigValues.CHART_HISTORY_SIZE
        );

        const data = indicatorScript(candles, {});

        const img = chartCanvasRenderer.generateImage(candles, data.renderables || {});
        await this.bot.sendPhoto(chatId, img, {
          caption: `${getLinkText(symbol, GeneralTimeIntervals.h1)} price chart`,
          parse_mode: 'MarkdownV2',
        });
        count++;
      } catch (e) {
        this.logger?.error({
          chatId,
          type: LogMessageType.CHART_IMAGE_ERROR,
          message: `${symbol}, ${e}`,
        });
      }
    }

    if (count === 0) {
      await this.bot.sendMessage(chatId, `Looks like those currency are not present on Binance`);
    }
  }
}

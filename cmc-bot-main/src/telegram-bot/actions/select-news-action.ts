import TelegramBot from 'node-telegram-bot-api';
import { DynamicConfig } from '../../utils/dynamic-config';
import { CryptopanicNewsMapper } from '../../utils/cryptopanic-news-mapper';
import { DynamoDBClient } from '../../core/services/dynamo-db-client';
import { Requests } from '../../requests';
import { BotState } from '../state-machine';
import { StateMachine } from '@xstate/fsm';
import { BotStates, BotTransitions } from '../../types/enums';

export class SelectNewsAction implements BotState {
  public static readonly Key = BotStates.FETCH_LATEST_NEWS;

  constructor(
    private dynamicConfig: DynamicConfig,
    private bot: TelegramBot,
    private state: StateMachine.Service<any, any>,
    private dynamoDbClient: DynamoDBClient,
    private requests: Requests
  ) {}

  public async onEnter(message: TelegramBot.Message): Promise<void> {
    const chatId = message.chat.id;
    const savedState = await this.dynamoDbClient.getUserState(chatId);

    if (!savedState?.lastSelectedCrypto) {
      await this.bot.sendMessage(chatId, `Sorry, there is no selected currency, please try again`);
      return;
    }

    const newsByAsset = await this.requests.getNews(savedState?.lastSelectedCrypto);

    if (!Object.keys(newsByAsset).length) {
      this.bot.sendMessage(chatId, `There is not important news 🤷‍♂️`);
      return;
    }

    const dynamicConfigValues = await this.dynamicConfig.getConfig();
    const cryptopanicNewsMapper = new CryptopanicNewsMapper(dynamicConfigValues);

    try {
      const coinNewsMessage = cryptopanicNewsMapper.processDayTradingNews(newsByAsset);

      this.bot.sendMessage(chatId, coinNewsMessage, {
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: true,
      });
    } catch (e) {
      await this.bot.sendMessage(chatId, `Can't retrieve news at the moment 🤷‍♂️`);
    }

    this.state.send(BotTransitions.NEWS_SELECTED);
  }
}

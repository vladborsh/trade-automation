import { createMachine, interpret, StateMachine } from '@xstate/fsm';
import { BotStates, BotTransitions } from '../types/enums';
import TelegramBot from 'node-telegram-bot-api';
import { InitialStateAction } from './actions/initial-state-action';
import { EnvConfig } from '../env-config';
import { DynamicConfig } from '../utils/dynamic-config';
import { BinanceClient } from '../core/services/binance-client';
import { CapitalComClient } from '../core/services/capital-com-client';
import { CryptoCurrencySortAction } from './actions/crypto-currency-sort-action';
import { FetchAssetChartStateAction } from './actions/fetch-asset-chart-action';
import { Requests } from '../requests';
import { AskAboutNewsMessageAction } from './actions/ask-about-news-message-action';
import { SelectNewsAction } from './actions/select-news-action';
import { SortCryptoMessageAction } from './actions/sort-crypto-message-action';
import { AcceptAssetChartNameAction } from './actions/accept-asset-chart-name-action';
import { container } from '../container';
import { DynamoDBClient } from '../core/services/dynamo-db-client';
import { ChartCanvasRenderer } from '../core/services/chart-canvas-renderer';

export interface BotState {
  onEnter(message: TelegramBot.Message): Promise<void>;
}

export function createBotState(initial = BotStates.INITIAL): StateMachine.Service<any, any> {
  const states: Record<BotStates, any> = {
    [InitialStateAction.Key]: {
      on: {
        [BotTransitions.GET_ASSET_CHART]: AcceptAssetChartNameAction.Key,
      },
    },
    [CryptoCurrencySortAction.Key]: {
      on: {
        [BotTransitions.GO_TO_CRYPTO_NEWS]: AskAboutNewsMessageAction.Key,
        [BotTransitions.BACK_TO_START]: InitialStateAction.Key,
      },
    },
    [AskAboutNewsMessageAction.Key]: {
      on: {
        [BotTransitions.SELECT_TO_SEE_CRYPTO_NEWS]: SelectNewsAction.Key,
        [BotTransitions.SELECT_DO_NOT_SEE_CRYPTO_NEWS]: InitialStateAction.Key,
        [BotTransitions.BACK_TO_START]: InitialStateAction.Key,
      },
    },
    [SelectNewsAction.Key]: {
      on: {
        [BotTransitions.NEWS_SELECTED]: InitialStateAction.Key,
        [BotTransitions.BACK_TO_START]: InitialStateAction.Key,
      },
    },
    [AcceptAssetChartNameAction.Key]: {
      on: {
        [BotTransitions.GET_SELECTED_CRYPTO_CHART]: FetchAssetChartStateAction.Key,
        [BotTransitions.BACK_TO_START]: InitialStateAction.Key,
      },
    },
    [ FetchAssetChartStateAction.Key]: {
      on:  {
        [BotTransitions.BACK_TO_START]: InitialStateAction.Key,
      },
    },
    [SortCryptoMessageAction.Key]: {
      on: {
        [BotTransitions.BACK_FROM_CRYPTO_SORT]: InitialStateAction.Key,
        [BotTransitions.BACK_TO_START]: InitialStateAction.Key,
      },
    },
  };
  const machine = createMachine({
    initial,
    states,
  });

  return interpret(machine);
}

function getDependencies() {
  const envConfig = EnvConfig.getInstance();
  const dynamicConfig = container.get(DynamicConfig);
  const dynamoDBClient = container.get(DynamoDBClient);
  const binanceClient = container.get(BinanceClient);
  const capitalComClient = container.get(CapitalComClient);
  const chartCanvasRenderer = container.get(ChartCanvasRenderer);

  return {
    envConfig,
    dynamicConfig,
    dynamoDBClient,
    binanceClient,
    capitalComClient,
    chartCanvasRenderer,
  };
}

export function inferState(
  bot: TelegramBot,
  botState: BotStates,
  state: StateMachine.Service<any, any>
): BotState {
  const { binanceClient, capitalComClient, dynamicConfig, dynamoDBClient, envConfig, chartCanvasRenderer } =
    getDependencies();

  const stateClasses: Record<BotStates, () => BotState> = {
    [InitialStateAction.Key]: () => new InitialStateAction(bot),
    [CryptoCurrencySortAction.Key]: () => new CryptoCurrencySortAction(bot),
    [AcceptAssetChartNameAction.Key]: () => new AcceptAssetChartNameAction(bot, state),
    [FetchAssetChartStateAction.Key]: () =>
      new FetchAssetChartStateAction(
        envConfig,
        dynamicConfig,
        binanceClient,
        chartCanvasRenderer,
        capitalComClient,
        bot,
        state
      ),
    [SortCryptoMessageAction.Key]: () => new SortCryptoMessageAction(bot),
    [AskAboutNewsMessageAction.Key]: () => new AskAboutNewsMessageAction(bot),
    [SelectNewsAction.Key]: () =>
      new SelectNewsAction(dynamicConfig, bot, state, dynamoDBClient, new Requests(envConfig)),
    };

  return stateClasses[botState]();
}

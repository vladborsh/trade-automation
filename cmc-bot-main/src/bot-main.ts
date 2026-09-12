import TelegramBot from 'node-telegram-bot-api';
import { StateMachine } from '@xstate/fsm';
import { EnvConfig } from './env-config';
import { createBotState, inferState } from './telegram-bot/state-machine';
import { BotStates, BotTransitions } from './types/enums';
import { DynamoDBClient } from './core/services/dynamo-db-client';
import { botPromptStates } from './telegram-bot/bot-prompt-states.config';
import { Logger } from 'winston';
import { StrategyRunner } from './strategy/strategy-runner';
import { setAxiosInterceptors } from './utils/http-interceptors';
import { ForexFactoryTask } from './core/services/forex-factory-service';
import { container } from './container';
import { BotNotifier } from './core/services/bot-notifier';
import { TimerScheduler } from './core/scheduler/scheduler';

const botStates: Record<TelegramBot.ChatId, StateMachine.Service<any, any>> = {};

export async function runTelegramBot() {
  const logger = container.get(Logger);
  const bot = container.get(TelegramBot);
  const dynamoDbClient = container.get(DynamoDBClient);
  const forexFactoryTask = container.get(ForexFactoryTask);

  setAxiosInterceptors(logger);

  const notifier = container.get(BotNotifier);
  const strategyRunner = container.get(StrategyRunner);

  const scheduler = container.get(TimerScheduler);
  const timer = scheduler.getTimer();

  timer.subscribe(() => forexFactoryTask.execute());
  timer.subscribe(() => strategyRunner.execute());

  forexFactoryTask.getNewsChannel$().subscribe(message => notifier.sendMessageToAll(message));
  strategyRunner.getMessageChannel$().subscribe(message => notifier.sendMessageToAll(message));
  strategyRunner.getPhotoMessageChannel$().subscribe(message => notifier.sendPhotoToAll(message[1], message[0]));

  bot.on('message', async (message: TelegramBot.Message) => {
    await handleMessage(bot, message, dynamoDbClient);
  });
}

async function handleMessage(
  bot: TelegramBot,
  message: TelegramBot.Message,
  dynamoDbClient: DynamoDBClient
) {

  const chatId = message.chat.id;
  const chatBotState = botStates[message.chat.id] || (await getBotState(chatId));

  if (!message.text && message.new_chat_members) {
    const botUsername = (await bot.getMe()).username;
    const botWasAdded = message.new_chat_members.some(member => member.username === botUsername);

    if (botWasAdded) {
      await dynamoDbClient.updateDialogState(chatId.toString(), BotStates.INITIAL);

      chatBotState.send(BotTransitions.BACK_TO_START);

      inferState(bot, BotStates.INITIAL, chatBotState).onEnter(message);
    }
    return;
  }

  console.log(message.text);

  if (message.text === '/start') {
    await dynamoDbClient.updateDialogState(chatId.toString(), BotStates.INITIAL);

    chatBotState.send(BotTransitions.BACK_TO_START);

    inferState(bot, BotStates.INITIAL, chatBotState).onEnter(message);
    return;
  }

  if (!message.text) {
    return;
  }
}

async function processStateTransitions(
  bot: TelegramBot,
  message: TelegramBot.Message,
  chatBotState: StateMachine.Service<any, any>,
  dynamoDbClient: DynamoDBClient
) {
  let newState: BotStates;

  do {
    newState = chatBotState.state.value;

    await dynamoDbClient.updateDialogState(message.chat.id.toString(), newState);

    await inferState(bot, newState, chatBotState).onEnter(message);

    if (chatBotState.state.value !== newState) {
      await dynamoDbClient.updateDialogState(message.chat.id.toString(), chatBotState.state.value);
    }
  } while (
    newState !== chatBotState.state.value &&
    !botPromptStates.includes(chatBotState.state.value)
  );
}

async function getBotState(chatId: TelegramBot.ChatId): Promise<StateMachine.Service<any, any>> {
  const dynamoDbClient = DynamoDBClient.getInstance(EnvConfig.getInstance());
  const savedState = await dynamoDbClient.getUserState(chatId);
  const stateMachine = createBotState(savedState?.dialogState);

  stateMachine.start();

  return stateMachine;
}

async function resetChat(
  state: StateMachine.Service<any, any>,
  dynamoDbClient: DynamoDBClient,
  message: TelegramBot.Message,
  bot: TelegramBot
) {
  if (state) {
    state.send(BotTransitions.BACK_TO_START);

    await dynamoDbClient.updateDialogState(message.chat.id.toString(), BotStates.INITIAL);

    inferState(bot, BotStates.INITIAL, state).onEnter(message);
  }
}

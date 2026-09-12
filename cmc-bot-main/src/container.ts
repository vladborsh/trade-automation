import { Container } from 'inversify';
import { ConfigClient } from './core/services/config-client';
import { DynamicConfig } from './utils/dynamic-config';
import { ForexFactoryTask } from './core/services/forex-factory-service';
import { EnvConfig } from './env-config';
import { Logger } from 'winston';
import { BotLogger } from './utils/bot-logger';
import { DynamoDBClient } from './core/services/dynamo-db-client';
import { BinanceClient } from './core/services/binance-client';
import { CapitalComClient } from './core/services/capital-com-client';
import { StrategyNotificationMessages } from './strategy/strategy-notification-messages';
import { ChartCanvasRenderer } from './core/services/chart-canvas-renderer';
import { StrategyRunner } from './strategy/strategy-runner';
import { BotNotifier } from './core/services/bot-notifier';
import TelegramBot from 'node-telegram-bot-api';
import { CapitalComSession } from './core/services/capital-com-session';
import { TimerScheduler } from './core/scheduler/scheduler';
import { StrategyProvider } from './strategy/strategy-provider';
import { RiskManager } from './strategy/risk-manager';

export const container = new Container();
container.bind(EnvConfig).toSelf();
container.bind(TimerScheduler).toSelf();
container
  .bind(Logger)
  .toResolvedValue((envConfig: EnvConfig) => BotLogger.getInstance(envConfig), [EnvConfig]);
container.bind(ConfigClient).toSelf();
container.bind(DynamicConfig).toSelf();
container.bind(DynamoDBClient).toSelf();
container
  .bind(TelegramBot)
  .toResolvedValue(
    (envConfig: EnvConfig) => new TelegramBot(envConfig.TG_TOKEN || '', { polling: true }),
    [EnvConfig]
  )
  .inSingletonScope();
container.bind(BotNotifier).toSelf();

container.bind(ForexFactoryTask).toSelf();
container
  .bind(BinanceClient)
  .toSelf()
  .inSingletonScope()
  .onActivation((_ctx, binanceClient: BinanceClient) => {
    binanceClient.init();
    return binanceClient;
  });
container.bind(CapitalComSession).toSelf().inSingletonScope();
container
  .bind(CapitalComClient)
  .toSelf()
  .inSingletonScope()
  .onActivation((_ctx, capitalComClient: CapitalComClient) => {
    capitalComClient.init();
    return capitalComClient;
  });
container
  .bind(ChartCanvasRenderer)
  .toSelf()
  .onActivation((_ctx, chartCanvasRenderer: ChartCanvasRenderer) => {
    chartCanvasRenderer.init();
    return chartCanvasRenderer;
  });
container.bind(StrategyNotificationMessages).toSelf();

container.bind(RiskManager).toSelf();
container.bind(StrategyProvider).toSelf();

container
  .bind(StrategyRunner)
  .toSelf()
  .onActivation((_ctx, strategyRunner: StrategyRunner) => {
    strategyRunner.init();
    return strategyRunner;
  });

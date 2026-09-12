import { Logger } from 'winston';
import { LoggerBase } from './logger-base';
import { EnvConfig } from '../env-config';
import { injectable } from 'inversify';

@injectable()
export class BotLogger extends LoggerBase {
  private static instance: Logger;

  private constructor(envConfig: EnvConfig) {
    super(envConfig);
    if (!BotLogger.instance) {
      BotLogger.instance = this.createLogger('bot');
    }
  }

  public static getInstance(envConfig: EnvConfig): Logger {
    if (!this.instance) {
      new BotLogger(envConfig);
    }
    return this.instance;
  }
}

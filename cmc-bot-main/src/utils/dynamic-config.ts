import { DynamicConfigValues } from "../interfaces/dynamic-config.interface";
import { injectable } from "inversify";
import { ConfigClient } from "../core/services/config-client";

@injectable()
export class DynamicConfig {
  constructor(private configClient: ConfigClient) {}

  public getConfig(): Promise<DynamicConfigValues> {
    return this.configClient.getObject<DynamicConfigValues>('telegram-bot-config', 'dynamic_config.json');
  }
}

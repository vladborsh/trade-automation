import { DynamicConfig } from "../utils/dynamic-config";
import { CapitalComClient } from "../core/services/capital-com-client";
import { RiskManager } from "./risk-manager";
import { StrategyTemplate } from "./strategy-template";
import { VWapStrategy } from "./vwap-strategy";
import { injectable } from "inversify";

@injectable()
export class StrategyProvider {
  constructor(
    private readonly capitalComClient: CapitalComClient,
    private readonly riskManager: RiskManager,
    private readonly dynamicConfig: DynamicConfig,
  ) {}

  public async getStrategies(): Promise<Record<string, StrategyTemplate>> {
    const config = await this.dynamicConfig.getConfig();

    return {
      nasdaq: new VWapStrategy(
        this.capitalComClient,
        'US100',
        'nasdaq',
        {
          timings: config.FOREX_TIMINGS,
          orderAliveTimings: config.FOREX_ORDER_ALIVE_TIMINGS,
          MIN_VWAP_ATR_RATIO: 2.5,
          MAX_VWAP_ATR_RATIO: 11.5,
          MAX_IFVG_TO_ATR_RATIO: 8,
        },
        this.riskManager
      ),
      snp: new VWapStrategy(
        this.capitalComClient,
        'US500',
        'snp',
        {
          timings: config.FOREX_TIMINGS,
          orderAliveTimings: config.FOREX_ORDER_ALIVE_TIMINGS,
          MIN_VWAP_ATR_RATIO: 2.5,
          MAX_VWAP_ATR_RATIO: 11.5,
          MAX_IFVG_TO_ATR_RATIO: 8,
        },
        this.riskManager,
      ),
      eurchf: new VWapStrategy(
        this.capitalComClient,
        'EURCHF',
        'eurchf',
        {
          timings: [
            [
              { hour: 3, minute: 2 },
              { hour: 3, minute: 20 },
            ],
          ],
          orderAliveTimings: [
            [
              { hour: 3, minute: 0 },
              { hour: 4, minute: 0 },
            ],
          ],
          MIN_VWAP_ATR_RATIO: 2.5,
          MAX_VWAP_ATR_RATIO: 11.5,
          MAX_IFVG_TO_ATR_RATIO: 8,
        },
        this.riskManager,
      ),
      gbpchf: new VWapStrategy(
        this.capitalComClient,
        'GBPCHF',
        'gbpchf',
        {
          timings: [
            [
              { hour: 3, minute: 3 },
              { hour: 3, minute: 20 },
            ],
          ],
          orderAliveTimings: [
            [
              { hour: 3, minute: 0 },
              { hour: 5, minute: 0 },
            ],
          ],
          MIN_VWAP_ATR_RATIO: 2.5,
          MAX_VWAP_ATR_RATIO: 11.5,
          MAX_IFVG_TO_ATR_RATIO: 8,
        },
        this.riskManager,
      ),
    };
  }
}

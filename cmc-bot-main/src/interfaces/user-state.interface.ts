import { CandleChartInterval_LT } from "binance-api-node";
import { BotStates, GeneralTimeIntervals } from "../types/enums";

export interface UserState{
  chatId: string;
  dialogState: BotStates;
  lastSelectedCrypto?: string[];
  watchList?: WatchListItem[];
}

export interface WatchListItem {
  symbol: string;
  timeFrame: GeneralTimeIntervals;
  exchange?: Exchange;
}

export enum Exchange {
  binance = 'binance',
  capitalcom = 'capitalcom',
}

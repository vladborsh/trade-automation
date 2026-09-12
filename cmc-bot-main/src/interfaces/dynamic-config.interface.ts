import { TimePoint } from '../strategy/interfaces/time-point.interface';
import { Exchange } from './user-state.interface';

export interface DynamicConfigValues {
  /* array of token symbols that we wan't to avoid in our analysis */
  OMIT_TOKENS: string[];
  /* minimal daily volume limit, we don't want to trade currency with low volume */
  MIN_DAILY_VOLUME: number;
  /* minimal weekly volume limit, we don't want to trade currency with low volume */
  MIN_WEEKLY_VOLUME: number;
  /* minimal daily relative (in percentage) price change, volatility indicator */
  MIN_DAILY_PERCENT_CHANGE: number;
  /* minimal daily relative (in percentage) volume change, volume growth meaning higher volatility */
  MIN_DAILY_VOLUME_CHANGE: number;
  /* maximum daily relative (in percentage) volume change, too fast volume growth means aggressive manipulations in market */
  MAX_DAILY_VOLUME_CHANGE: number;
  /* count of top selected currency after sorting */
  SELECTION_NUMBER: number;
  /* number of important news per currency */
  NEWS_NUMBER: number;
  /* maximum age limit for news, we aren't interested in old news */
  NEWS_AGE_DAYS_LIMIT: number;
  /* number of history candles to be fetched from exchange */
  CHART_HISTORY_SIZE: number;
  CANVAS_DOWN_CANDLE_COLOR: string;
  CANVAS_UP_CANDLE_COLOR: string;
  CANVAS_DEFAULT_PLOT_COLOR: string;
  CANVAS_HEIGHT: number;
  CANVAS_WIDTH: number;
  CANVAS_CANDLE_WIDTH: number;
  CANVAS_CANDLE_PADDING: number;
  ASSET_SHORTCUTS: Record<string, [string, Exchange]>;
  EXCHANGE_SHORTCUTS: Record<string, Exchange>;
  FOREX_TIMINGS: [TimePoint, TimePoint][],
  FOREX_ORDER_ALIVE_TIMINGS: [TimePoint, TimePoint][],
}

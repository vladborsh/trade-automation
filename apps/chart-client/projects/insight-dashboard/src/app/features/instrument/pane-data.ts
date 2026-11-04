import type {
  EconomicEvent, WebCandle, WebCandlesResponse, WebFundingResponse, WebLiquidationEvent, WebLiquidationsResponse,
  WebLongShortResponse,
} from '@trade-automation/contracts';
import type { Coverage } from './coverage-labels';

/**
 * One window of everything the instrument row draws. Lifted out of
 * `instrument-chart.component.ts` by IB-BUG-009 so `panel-series.ts` can take it without
 * importing the component that imports `panel-series.ts`.
 */
export interface PaneData {
  instrument: string;
  timeframe: string;
  bucket: string;
  candles: WebCandlesResponse;
  openInterest: Array<{ time: number; value: number; notional: number | null }>;
  /**
   * IB-081 — where the OI series begins when that is later than the window (`coverageFrom` /
   * `truncated` of `/series/oi`). Kept beside the points because `openInterest` is the bare array.
   * Absent before IB-081 and on a read that reached its whole window.
   */
  openInterestCoverage?: Coverage;
  funding: WebFundingResponse;
  longShort: WebLongShortResponse;
  liquidations: WebLiquidationsResponse;
  /** IB-039 §12.5 — individual events, drawn as bubbles over the price panel. */
  liquidationEvents: readonly WebLiquidationEvent[];
  /** The venues those events actually came from — the label is built from this, not a filter. */
  liquidationVenues: readonly string[];
  /**
   * 2026-10-24 — 1d perp candles for the window plus the two weeks before it, for the previous
   * day/week high and low (`prior-levels.ts`). Separate from `candles` because on 1m the window
   * is one day and holds no previous day. Empty when the read failed: the levels drop out, not
   * the chart.
   */
  dailyCandles: readonly WebCandle[];
  /**
   * IB-060 — USD high-impact events and holidays in the window (`/api/web/calendar/events`), for
   * the event lines, their tooltip and the holiday bands. Empty when the read failed: the marks
   * drop out, not the chart.
   */
  calendarEvents: readonly EconomicEvent[];
  /**
   * True when this is the previous window with earlier history prepended (scrolling left), so the
   * chart keeps the reader's view instead of jumping to the whole window. Absent on a fresh load.
   */
  extendsPrevious?: boolean;
  /**
   * IB-066 — true when this is the window on screen with the live tail joined on (`appendLater`):
   * the chart keeps the reader's view, and follows the new bar only if they were at the right edge.
   */
  extendsLater?: boolean;
}

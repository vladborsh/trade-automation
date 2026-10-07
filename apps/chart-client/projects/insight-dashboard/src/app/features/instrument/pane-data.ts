import type {
  WebCandlesResponse, WebFundingResponse, WebLiquidationsResponse, WebLongShortResponse,
} from '@trade-automation/contracts';

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
  funding: WebFundingResponse;
  longShort: WebLongShortResponse;
  liquidations: WebLiquidationsResponse;
}

import type {
  WebCandlesResponse, WebFundingResponse, WebLiquidationsResponse, WebLongShortResponse,
} from '@trade-automation/contracts';

/**
 * IB-031 — everything the instrument page's panels draw from, in one object.
 *
 * Extracted from the chart component in IB-BUG-009 so that `panel-definitions.ts` can describe
 * the panels without importing a component (and so the component can be replaced without
 * touching the shape the page assembles).
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

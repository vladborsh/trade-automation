import type { Signal, WritableSignal } from '@angular/core';
import type { WebTimeframe, WebTopLiquidation } from '@trade-automation/contracts';
import type { InsightApiClient } from '../../core/insight-api.client';
import { fetchCandleTail, fetchSideTail, type WindowRequest } from './instrument-window';
import { CANDLES_EVERY_MS, SIDE_EVERY_MS, candleTailFrom, dailyTailFrom, sideTailFrom, type TailJob } from './live-tail';
import type { PaneData } from './pane-data';
import { appendLater } from './pane-merge';
import { bucketFor, sideWindow, windowFor } from './time-range';

/** What the instrument page lends its two tail jobs: its state, and how to refresh the summary. */
export interface TailPage {
  panes: WritableSignal<PaneData | null>;
  top: WritableSignal<WebTopLiquidation[]>;
  symbol: Signal<string>;
  timeframe: Signal<WebTimeframe>;
  refreshSummary: (symbol: string) => void;
}

/**
 * IB-066 — the instrument page's two polls for `LiveTail`, out of the component to keep it under
 * the AGENTS.md ceiling. Each reads, then hands back how to apply what it read; the scheduler
 * decides whether it still may (`live-tail.ts`). A job only runs when the page has a window
 * (`busy` in the component), so `panes()` is read as present.
 */
export function instrumentTailJobs(api: InsightApiClient, page: TailPage): TailJob[] {
  const request = (fromMs: number, toMs: number): WindowRequest => {
    const timeframe = page.timeframe();
    return { symbol: page.symbol(), fromMs, toMs, timeframe, bucket: bucketFor(timeframe) };
  };
  const join = (tail: Parameters<typeof appendLater>[1]) => page.panes.update((p) => (p ? appendLater(p, tail) : p));

  /** The 5 s poll: the bars from the last one on screen to now. */
  const candles: TailJob = {
    every: CANDLES_EVERY_MS,
    read: async (sinceMs, nowMs) => {
      const tail = await fetchCandleTail(api, request(candleTailFrom(page.panes()!, sinceMs), nowMs));
      return () => join(tail);
    },
  };

  /**
   * The minute's poll: the database panes from where the last read ended; the top-50 table over
   * the window the timeframe opens with, rolled forward to now; the summary under the chart.
   */
  const side: TailJob = {
    every: SIDE_EVERY_MS,
    read: async (sinceMs, nowMs) => {
      const panes = page.panes()!;
      const symbol = page.symbol();
      const opening = sideWindow(windowFor(page.timeframe(), nowMs).fromMs, nowMs);
      const [tail, top] = await Promise.all([
        fetchSideTail(api, request(sideTailFrom(sinceMs, panes.timeframe, panes.bucket), nowMs), dailyTailFrom(panes, nowMs)),
        api.topLiquidations(symbol, opening.fromMs, nowMs, 50),
      ]);
      return () => {
        join(tail);
        page.top.set(top.rows);
        page.refreshSummary(symbol);
      };
    },
  };

  return [candles, side];
}

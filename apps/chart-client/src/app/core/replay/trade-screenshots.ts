import type { FillEvent, Order } from '@trade-automation/contracts';
import { captureChart, type TakeScreenshot } from './capture-chart';
import type { ScreenshotJob } from './screenshot-upload.queue';

export interface TradeScreenshotsDeps {
  /** The open session, or null (nothing is captured without one). */
  sessionId(): string | null;
  /** The panel's chart picture, or null when the panel has no chart. */
  captureOf(panelId: string): TakeScreenshot | null;
  enqueue(job: ScreenshotJob): void;
  /** Replaceable in specs (jsdom has no canvas). */
  capture?: (take: TakeScreenshot) => Promise<Blob> | null;
}

/**
 * backtest-app-system-design.md §9.2 (decisions 6, 27) — when the workspace takes a trade's
 * pictures. Capturing is synchronous (the pixels of that moment); encoding and uploading are not.
 * - entry: in the Enter handler, before the place op is pushed — the picture the decision was made
 *   on, at placement even for a limit. The order id only exists after the 201, so the capture is
 *   held (`entryPlaced`) until the place outcome arrives; a refused order drops it.
 * - exit: in the queue's response handler, one picture per `exit` event in a response, whatever
 *   closed it — a coalesced advance with several exits gives several; a manual close's response
 *   has no events, so its closed order counts as the exit.
 */
export class TradeScreenshots {
  private readonly capture: (take: TakeScreenshot) => Promise<Blob> | null;

  constructor(private readonly deps: TradeScreenshotsDeps) {
    this.capture = deps.capture ?? ((take) => captureChart(take));
  }

  /** Synchronously, before the place request: the panel's picture now, or null without a chart. */
  captureEntry(panelId: string): Promise<Blob> | null {
    return this.shoot(panelId);
  }

  entryPlaced(orderId: string, png: Promise<Blob> | null | undefined): void {
    if (png) this.enqueue(orderId, 'entry', png);
  }

  /** Every exit in an advance or place response; `panelOf` finds each order's panel. */
  exits(events: readonly FillEvent[], panelOf: (orderId: string) => string | undefined): void {
    for (const e of events) {
      if (e.kind !== 'exit') continue;
      const panelId = panelOf(e.orderId);
      const png = panelId === undefined ? null : this.shoot(panelId);
      if (png) this.enqueue(e.orderId, 'exit', png);
    }
  }

  /** A manual close's answer: the order, now closed. */
  closed(order: Order): void {
    if (order.status !== 'closed') return;
    const png = this.shoot(order.panelId);
    if (png) this.enqueue(order.id, 'exit', png);
  }

  private enqueue(orderId: string, kind: ScreenshotJob['kind'], png: Promise<Blob>): void {
    const sessionId = this.deps.sessionId();
    if (sessionId) this.deps.enqueue({ sessionId, orderId, kind, png });
  }

  private shoot(panelId: string): Promise<Blob> | null {
    const take = this.deps.captureOf(panelId);
    return take ? this.capture(take) : null;
  }
}

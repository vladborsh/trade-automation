import type { ScreenshotKind } from '@trade-automation/contracts';

/** A `screenshots` row (architecture/backtest-app-system-design.md §3); the bytes are in the ScreenshotStore. */
export interface ScreenshotRecord {
  id: string;
  sessionId: string;
  orderId: string;
  kind: ScreenshotKind;
  storeKey: string;
  widthPx: number;
  heightPx: number;
  bytes: number;
  capturedAtMs: number;
}

export type NewScreenshot = Omit<ScreenshotRecord, 'id'>;

/**
 * `screenshots`, one row per (order, kind), the write-once gate (`unique(order_id, kind)`,
 * decision 27). Tenancy: callers pass an order already resolved through the session they found
 * for the cookie user; this port never sees ids straight from a URL.
 */
export interface ScreenshotRepository {
  /**
   * Claims the (order, kind) slot. Returns the row, or null when it is already taken. Inside a
   * transaction, a concurrent claimer blocks on the unique index until this one commits (then
   * gets null) or rolls back (then gets the slot).
   */
  insertIfAbsent(row: NewScreenshot): Promise<ScreenshotRecord | null>;
  find(orderId: string, kind: ScreenshotKind): Promise<ScreenshotRecord | null>;
  listByOrder(orderId: string): Promise<ScreenshotRecord[]>;
}

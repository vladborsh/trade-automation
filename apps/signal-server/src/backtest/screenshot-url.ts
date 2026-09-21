import type { ScreenshotKind } from '@trade-automation/contracts';

/**
 * The relative API URL of a stored screenshot, as `GET …/orders/:orderId` returns it
 * (backtest-app-system-design.md §7.2: reads are proxied, the bucket stays private, no presigned URLs).
 */
export function screenshotUrl(sessionId: string, orderId: string, kind: ScreenshotKind): string {
  return `/api/backtest/sessions/${sessionId}/orders/${orderId}/screenshots/${kind}`;
}

import { Injectable, inject, signal } from '@angular/core';
import type { ScreenshotKind } from '@trade-automation/contracts';
import { isApiError } from '../api/api-error';
import { BacktestClient } from '../api/backtest.client';
import { backoffMs, isRetryable } from './mutation-rules';

export interface ScreenshotJob {
  sessionId: string;
  orderId: string;
  kind: ScreenshotKind;
  /** The PNG; captured before the job exists, possibly still encoding. */
  png: Promise<Blob>;
}

/** After this many failed attempts (≈ 3½ min at the 8 s backoff cap) an upload is given up. */
export const MAX_UPLOAD_ATTEMPTS = 30;

export const shotKey = (orderId: string, kind: ScreenshotKind) => `${orderId}:${kind}`;

/**
 * backtest-app-system-design.md §9.2 — uploads trade screenshots (`PUT …/screenshots/:kind`).
 * A root service, so an upload started in the workspace finishes after the route changes. Every
 * job runs on its own, so one backing off never holds up another, and none of this touches the
 * AdvanceQueue: stepping never waits for a picture.
 * - a network failure or 5xx: retried with the AdvanceQueue's capped backoff;
 * - 409 SCREENSHOT_EXISTS: success (write-once; an earlier attempt landed);
 * - any other 4xx: final, logged (a deleted session, a picture the server refuses).
 */
@Injectable({ providedIn: 'root' })
export class ScreenshotUploadQueue {
  private readonly client = inject(BacktestClient);
  /** Replaceable in specs. */
  delay: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** `orderId:kind` of every upload still in progress. */
  readonly pending = signal<ReadonlySet<string>>(new Set());
  /** `orderId:kind` of every upload that is now on the server. */
  readonly uploaded = signal<ReadonlySet<string>>(new Set());

  enqueue(job: ScreenshotJob): void {
    const key = shotKey(job.orderId, job.kind);
    if (this.pending().has(key) || this.uploaded().has(key)) return;
    this.pending.update((s) => new Set(s).add(key));
    void this.run(job, key);
  }

  private async run(job: ScreenshotJob, key: string): Promise<void> {
    let ok = false;
    try {
      const png = await job.png;
      ok = await this.upload(job, png);
    } catch (err) {
      console.warn(`[ScreenshotUploadQueue] no ${job.kind} picture for order ${job.orderId}`, err);
    }
    this.pending.update((s) => {
      const next = new Set(s);
      next.delete(key);
      return next;
    });
    if (ok) this.uploaded.update((s) => new Set(s).add(key));
  }

  private async upload(job: ScreenshotJob, png: Blob): Promise<boolean> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.client.uploadScreenshot(job.sessionId, job.orderId, job.kind, png);
        return true;
      } catch (err) {
        if (isApiError(err, 409)) return true;
        if (!isRetryable(err) || attempt + 1 >= MAX_UPLOAD_ATTEMPTS) {
          console.warn(`[ScreenshotUploadQueue] gave up the ${job.kind} picture for order ${job.orderId}`, err);
          return false;
        }
        await this.delay(backoffMs(attempt));
      }
    }
  }
}

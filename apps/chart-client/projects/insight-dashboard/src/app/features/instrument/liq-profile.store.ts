import { Injectable, inject, signal, type OnDestroy } from '@angular/core';
import type { WebLiqProfileResponse } from '@trade-automation/contracts';
import { InsightApiClient } from '../../core/insight-api.client';
import type { BandDetail } from './liq-profile-geometry';
import { answerServes, sameView, type ProfileView } from './liq-profile-view';

/** Quiet time after the last view change before a read: a drag or a wheel zoom asks once, at the end. */
export const PROFILE_DEBOUNCE_MS = 300;

/** The band under the pointer on the desktop strip, where the pointer is (chart CSS px), for the tooltip. */
export interface ProfileHover {
  detail: BandDetail;
  x: number;
  y: number;
}

/**
 * IB-153 — the instrument page's liquidation profile: the view the price pane reports, the answer read
 * for it, and the band hovered. Provided by `InstrumentComponent`, so the chart's strip, its tooltip and
 * the phone histogram under the chart share one read without passing it through the page.
 *
 * **No storm on pan or zoom:** a view the answer on hand still serves (same coin and window, the price
 * span inside the cover at the same step) is no read at all; anything else waits `PROFILE_DEBOUNCE_MS` of
 * quiet, and only the newest read's answer is kept (a generation counter, as the page's `load()`). The
 * server caches per (coin, window, grid) on top.
 */
@Injectable()
export class LiqProfileStore implements OnDestroy {
  private readonly api = inject(InsightApiClient);

  readonly answer = signal<WebLiqProfileResponse | null>(null);
  readonly failed = signal(false);
  readonly view = signal<ProfileView | null>(null);
  readonly hover = signal<ProfileHover | null>(null);
  /** The last close on the chart, for the current-price mark. */
  readonly lastPrice = signal<number | null>(null);

  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private readonly listeners = new Set<() => void>();

  /** The price pane's view, on every repaint; cheap when nothing changed. */
  setView(view: ProfileView): void {
    if (sameView(this.view(), view)) return;
    this.view.set(view);
    const answer = this.answer();
    if (answer && answer.symbol !== view.symbol) this.answer.set(null); // never another coin's bars
    this.clearTimer();
    if (answerServes(this.answer(), view)) {
      this.generation += 1; // a read in flight was for a view the reader has left; the answer on hand serves
      return;
    }
    this.timer = setTimeout(() => void this.read(view), PROFILE_DEBOUNCE_MS);
  }

  /** A painter (the strip) asks to be told when the answer changes, to repaint. Returns the unsubscribe. */
  listen(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  ngOnDestroy(): void {
    this.clearTimer();
    this.generation += 1;
    this.listeners.clear();
  }

  private async read(view: ProfileView): Promise<void> {
    this.timer = null;
    const generation = ++this.generation;
    try {
      const answer = await this.api.liquidationProfile(view.symbol, view.fromMs, view.toMs, view.lo, view.hi);
      if (generation !== this.generation) return;
      this.answer.set(answer);
      this.failed.set(false);
    } catch {
      if (generation !== this.generation) return;
      // a failed read leaves the profile off, not the page; the next view change asks again
      this.answer.set(null);
      this.failed.set(true);
    }
    for (const fn of this.listeners) fn();
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

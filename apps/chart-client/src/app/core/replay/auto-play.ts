import { signal } from '@angular/core';

/** T-052: seconds per candle the user can pick; 0.5 s by default. */
export const AUTOPLAY_SPEEDS_MS = [250, 500, 1000, 2000] as const;
export type AutoPlaySpeedMs = (typeof AUTOPLAY_SPEEDS_MS)[number];
export const DEFAULT_AUTOPLAY_SPEED_MS: AutoPlaySpeedMs = 500;

/** What auto-play needs from the workspace, read at every tick. */
export interface AutoPlayHost {
  /** The same path as `→` and the Step button. */
  step(): void;
  /** Stepping is possible at all: started, not at the period end, not complete, not view-only. */
  canStep(): boolean;
  /** A step is in flight, waiting for candles, or already queued (T-037). */
  stepPending(): boolean;
}

/**
 * T-052 — Play / Pause: one step per interval through the ordinary step path. A tick that finds a
 * step still pending is skipped, never queued, so playing can't pile up steps (or advance requests;
 * the queue coalesces advances anyway). Playing stops by itself once stepping becomes impossible
 * (the period end, a completed session). The workspace also pauses it on view-only, on a reload
 * (a new engine) and when the tab is hidden. Manual steps and order actions work while playing.
 */
export class AutoPlay {
  readonly playing = signal(false);
  readonly speedMs = signal<AutoPlaySpeedMs>(DEFAULT_AUTOPLAY_SPEED_MS);
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly host: AutoPlayHost) {}

  play(): void {
    if (this.playing() || !this.host.canStep()) return;
    this.playing.set(true);
    this.schedule();
  }

  pause(): void {
    this.playing.set(false);
    this.cancel();
  }

  toggle(): void {
    if (this.playing()) this.pause();
    else this.play();
  }

  /** A new speed applies from the next candle; a running interval restarts with it. */
  setSpeed(ms: AutoPlaySpeedMs): void {
    this.speedMs.set(ms);
    if (this.playing()) {
      this.cancel();
      this.schedule();
    }
  }

  private tick(): void {
    this.timer = null;
    if (!this.playing()) return;
    if (!this.host.canStep()) return this.pause();
    if (!this.host.stepPending()) this.host.step();
    this.schedule();
  }

  private schedule(): void {
    this.timer = setTimeout(() => this.tick(), this.speedMs());
  }

  private cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

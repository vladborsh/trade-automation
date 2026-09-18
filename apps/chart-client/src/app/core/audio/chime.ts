import { InjectionToken, signal, type Signal } from '@angular/core';

/**
 * architecture/economic-calendar.md §11.5 — the only Web Audio code in the
 * client: two short sine beeps, generated, no asset. Browsers keep an
 * `AudioContext` suspended until a user gesture, so `arm()` must be called
 * from one (a click, a keypress); `state` makes armed/unarmed visible.
 */
export type ChimeState = 'running' | 'suspended' | 'unavailable';

export interface Chime {
  readonly state: Signal<ChimeState>;
  /** Create/resume the audio context. Call from a user gesture. */
  arm(): Promise<void>;
  /** Play the chime now — a no-op unless the context is running (never queue a stale beep). */
  play(): void;
}

const BEEP_HZ = 880;
const BEEP_S = 0.15;
const GAP_S = 0.12;
const GAIN = 0.2;
const RAMP_S = 0.015;

export class WebAudioChime implements Chime {
  private readonly stateSignal = signal<ChimeState>(typeof AudioContext === 'undefined' ? 'unavailable' : 'suspended');
  private context: AudioContext | null = null;

  readonly state = this.stateSignal.asReadonly();

  async arm(): Promise<void> {
    if (typeof AudioContext === 'undefined') {
      return;
    }
    if (!this.context) {
      this.context = new AudioContext();
      this.context.onstatechange = () => this.syncState();
    }
    try {
      await this.context.resume();
    } catch {
      // not a gesture the browser accepts — stays suspended, visibly
    }
    this.syncState();
  }

  play(): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running') {
      return;
    }
    const start = ctx.currentTime + 0.01;
    for (const offset of [0, BEEP_S + GAP_S]) {
      const t = start + offset;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = BEEP_HZ;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(GAIN, t + RAMP_S);
      gain.gain.setValueAtTime(GAIN, t + BEEP_S - RAMP_S);
      gain.gain.linearRampToValueAtTime(0, t + BEEP_S);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + BEEP_S);
    }
  }

  private syncState(): void {
    this.stateSignal.set(this.context?.state === 'running' ? 'running' : 'suspended');
  }
}

export const CHIME = new InjectionToken<Chime>('CHIME', {
  providedIn: 'root',
  factory: () => new WebAudioChime(),
});

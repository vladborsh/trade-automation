import { Injectable, inject, signal } from '@angular/core';
import { CHIME } from '../audio/chime';

const KEY = 'bt.closeSound';

/**
 * T-051 — whether a trade close plays a sound, remembered per browser (on by default). Browser
 * storage may be unavailable (private mode, blocked site data): then the choice lasts for the page.
 * The sound is the app's one chime (core/audio/chime.ts), which the browser only lets play after a
 * user gesture has armed it — the toggle and the workspace's keys/clicks arm it.
 */
@Injectable({ providedIn: 'root' })
export class CloseSoundSetting {
  private readonly chime = inject(CHIME);
  readonly on = signal(readStored());

  toggle(): void {
    this.on.update((v) => !v);
    try {
      localStorage.setItem(KEY, this.on() ? 'on' : 'off');
    } catch {
      // storage unavailable: the choice lasts for this page only
    }
    if (this.on()) void this.chime.arm();
  }

  /** From a user gesture in the workspace: lets the browser play the chime later. */
  arm(): void {
    if (this.on() && this.chime.state() === 'suspended') void this.chime.arm();
  }

  play(): void {
    if (this.on()) this.chime.play();
  }
}

function readStored(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

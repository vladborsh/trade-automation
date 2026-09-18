import { signal } from '@angular/core';
import type { Chime, ChimeState } from '../audio/chime';

/** Spec double for `CHIME`: records plays, arms instantly. */
export class FakeChime implements Chime {
  readonly stateSignal = signal<ChimeState>('suspended');
  readonly state = this.stateSignal.asReadonly();
  plays = 0;
  arms = 0;

  async arm(): Promise<void> {
    this.arms++;
    this.stateSignal.set('running');
  }

  play(): void {
    if (this.stateSignal() === 'running') {
      this.plays++;
    }
  }
}

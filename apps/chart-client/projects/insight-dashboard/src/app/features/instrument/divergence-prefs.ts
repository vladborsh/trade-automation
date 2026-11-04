import { Injectable, signal } from '@angular/core';
import { browserStore } from './pane-heights';
import { loadDivergencesHidden, saveDivergencesHidden } from './chart-prefs';

/**
 * IB-110 — one switch for the OI divergence lines, shared by the page (which leaves them out of the
 * chart's data when hidden) and the chart's legend (whose «Дивергенции OI» entry flips it).
 * Remembered per viewer, like the legend switch (IB-105).
 */
@Injectable({ providedIn: 'root' })
export class DivergencePrefs {
  private readonly store = browserStore();
  readonly hidden = signal(loadDivergencesHidden(this.store));

  toggle(): void {
    this.hidden.update((h) => !h);
    saveDivergencesHidden(this.store, this.hidden());
  }
}

import { Injectable, signal } from '@angular/core';
import type { OiDivergenceKind } from '@trade-automation/contracts';
import { browserStore } from './pane-heights';
import { loadDivergencesHidden, saveDivergencesHidden } from './chart-prefs';

/**
 * IB-110 — the switches for the OI divergence lines, shared by the page (which leaves them out of the
 * chart's data when hidden) and the chart's legend (whose entries flip them). Remembered per viewer, like
 * the legend switch (IB-105). IB-144 (V44): one switch per kind — «Дивергенции OI» governs the regular
 * lines, «Скрытые дивергенции OI» the hidden ones, independently.
 */
@Injectable({ providedIn: 'root' })
export class DivergencePrefs {
  private readonly store = browserStore();
  /** Regular lines hidden (the «Дивергенции OI» entry). */
  readonly hidden = signal(loadDivergencesHidden(this.store, 'regular'));
  /** Hidden-kind lines hidden (the «Скрытые дивергенции OI» entry). */
  readonly hiddenKindHidden = signal(loadDivergencesHidden(this.store, 'hidden'));

  toggle(kind: OiDivergenceKind = 'regular'): void {
    const s = kind === 'hidden' ? this.hiddenKindHidden : this.hidden;
    s.update((h) => !h);
    saveDivergencesHidden(this.store, s(), kind);
  }
}

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { InstrumentPanelComponent } from './instrument-panel.component';
import { buildPanels } from './panel-definitions';
import type { PaneData } from './pane-data';

export type { PaneData } from './pane-data';

/**
 * IB-BUG-009 — the six panels in ONE row, left to right, each filling the viewport height.
 *
 * It was six panes stacked in a single chart; the user asked for a row and confirmed the shape
 * with a mock. The consequence worth stating: **the row scrolls horizontally and the page does
 * not.** On a narrow screen a vertical page scroll would move the panels off-screen one by one,
 * which is the opposite of the point — the panels are meant to be compared with each other.
 *
 * This component is now wiring only: `panel-definitions.ts` says what the six are and how each
 * draws, and `InstrumentPanelComponent` owns a chart apiece. Six charts rather than one is what
 * gives each panel its own autoscale, which is the second half of the bug.
 *
 * **Shared crosshair and time-range sync are deliberately absent.** The brief called them a
 * bonus; linking six time scales means each panel's `subscribeVisibleLogicalRangeChange` writing
 * to the other five, and the feedback loop that creates has to be damped by suppressing the
 * echo. That is a real mechanism to get wrong on a page whose point is the layout, so it is not
 * here — said out loud rather than quietly skipped.
 */
@Component({
  selector: 'app-instrument-chart',
  standalone: true,
  imports: [InstrumentPanelComponent],
  templateUrl: './instrument-chart.component.html',
  styleUrl: './instrument-chart.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstrumentChartComponent {
  readonly data = input<PaneData | null>(null);

  readonly panels = computed(() => {
    const data = this.data();
    return data === null ? [] : buildPanels(data);
  });
}

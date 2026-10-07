import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { I18nService } from '../../i18n/i18n.service';
import { InstrumentPanelComponent } from './instrument-panel.component';
import { liquidationPaneTitle } from './liquidation-histogram.renderer';
import type { PaneData } from './pane-data';
import { PANELS } from './panels.model';

export type { PaneData } from './pane-data';

/**
 * IB-BUG-009 — the instrument row: **six panels side by side**, Price | OI | Liquidations |
 * CVD/delta | Funding | L/S, each its own chart with its own time axis, title and autoscale
 * (user feedback 2026-10-07, `reports/zinc-raven-instrument-layout.md`).
 *
 * **What this replaced, and what it cost.** IB-031 drew one chart of six stacked panes and
 * argued for it in this file: *"Every pane shares the chart's time scale, which is what
 * time-aligned means… Separate charts would drift apart the moment anyone panned one."* That was
 * right, and the user has chosen the row anyway. So six charts mean six time scales, and the
 * drift is real.
 *
 * **Cross-panel pan/zoom sync is NOT implemented, and that is a decision, not an omission.**
 * The brief calls it a bonus and says to drop it rather than bend the layout around it, which is
 * what two attempts earned:
 *
 * 1. On the *logical* range (bar indices). The panels hold wildly different counts for the same
 *    window — 1m candles ≈ 1440, 5m open interest ≈ 288, funding a handful of settlements — so
 *    bar 100 is a different moment in each panel. Mirroring the index pulled the row apart.
 * 2. On the *time* range, which is comparable by construction. That failed for a subtler reason:
 *    lightweight-charts fires `subscribeVisibleTimeRangeChange` asynchronously, so a flag set
 *    around `setVisibleRange` is already cleared by the time the callback runs and cannot
 *    suppress the echo. Each panel then re-broadcast the range it had actually *achieved* after
 *    clamping to its own data, and the thinnest series won: the funding panel, with 15 points,
 *    dragged all six down to a five-minute window. The acceptance screenshot showed it.
 *
 * What replaces it: every panel opens on the SAME wall-clock window (`windowBounds`), so the row
 * reads as one window on arrival — which is what the layout is for. Panning one panel moves only
 * that panel. That cost is stated here and in the report rather than hidden.
 *
 * **If you come back to add the sync, start from (2), not from scratch.** The obstacle is not the
 * range type, it is that the callback is asynchronous, so a boolean set around `setVisibleRange`
 * cannot suppress the echo; a working version needs the receiving panel to *ignore a range it is
 * already showing* (idempotence), and still has to decide what to do when a panel cannot honour
 * the range because its own data is thinner. Decided on the Tech Lead's approval of 7a35f30
 * (2026-10-07): not worth that complexity for a bonus.
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

  readonly panels = PANELS;

  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);
  readonly paneTitle = (bucket: string, venue: string, undercounted: boolean): string =>
    liquidationPaneTitle(this.t, bucket, venue, undercounted);
}

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { I18nService } from '../../i18n/i18n.service';
import { loadLegendsHidden, saveLegendsHidden } from './chart-prefs';
import { browserStore } from './pane-heights';

/**
 * IB-105 (owner, 2026-11-04) — the one control that hides and shows every pane legend, ON the chart
 * at the price legend's top-left corner, where the eye already is when it wants the legend gone.
 * It replaces IB-099's toolbar switch: one control, one state for all panes, remembered per viewer
 * (`chart-prefs.ts`). The page reads `hidden()` to put `.legends-hidden` on its chart column; what
 * that hides is unchanged (the `.pane-legend` overlays) — nothing on the chart is removed or redrawn.
 *
 * The glyph is small and stays at the same spot either way, so the way back is where it was. On a
 * phone the hit area is 40 × 40 through an invisible pseudo-element, not a bigger glyph.
 */
@Component({
  selector: 'app-legend-toggle',
  standalone: true,
  templateUrl: './legend-toggle.component.html',
  styleUrl: './legend-toggle.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LegendToggleComponent {
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly hidden = signal(loadLegendsHidden(browserStore()));

  toggle(): void {
    this.hidden.set(!this.hidden());
    saveLegendsHidden(browserStore(), this.hidden());
  }
}

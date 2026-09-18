import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * architecture/chart-layouts.md §11.3 — a collapsed panel: a 28 px full-height strip with the
 * rotated panel title and an expand chevron. The whole strip is one button, so clicking anywhere
 * on it restores the panel. Never zero-width: a collapsed panel is always visible and recoverable.
 */
@Component({
  selector: 'app-collapsed-panel-strip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './collapsed-panel-strip.component.html',
  styleUrl: './collapsed-panel-strip.component.scss',
})
export class CollapsedPanelStripComponent {
  readonly panelId = input.required<string>();
  readonly title = input.required<string>();
  readonly restore = output<void>();
}

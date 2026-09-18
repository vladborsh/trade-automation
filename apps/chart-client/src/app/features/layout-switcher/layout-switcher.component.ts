import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LayoutsStore } from '../../core/state/layouts.store';

/**
 * architecture/chart-layouts.md §6.1 — replaces `instrument-switcher`
 * (removed, not hidden: "layouts instead of instruments"). A handful of
 * named layouts is a plain dropdown, not a searchable list.
 */
@Component({
  selector: 'app-layout-switcher',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './layout-switcher.component.html',
  styleUrl: './layout-switcher.component.scss',
})
export class LayoutSwitcherComponent {
  constructor(readonly layouts: LayoutsStore) {}

  onChange(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    this.layouts.select(id);
  }
}

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
  template: `
    <select class="layout-select" [value]="layouts.active()?.id" (change)="onChange($event)">
      @for (layout of layouts.layouts(); track layout.id) {
        <option [value]="layout.id">{{ layout.name }}</option>
      }
    </select>
  `,
  styles: [
    `
      .layout-select {
        background: #0d1117;
        color: #c9d1d9;
        border: 1px solid #30363d;
        padding: 4px 8px;
        font-family: inherit;
        font-size: 13px;
      }
      .layout-select:focus {
        outline: 1px solid #58a6ff;
      }
    `,
  ],
})
export class LayoutSwitcherComponent {
  constructor(readonly layouts: LayoutsStore) {}

  onChange(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    this.layouts.select(id);
  }
}

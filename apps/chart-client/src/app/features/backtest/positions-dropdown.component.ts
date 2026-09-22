import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { PositionsPanelComponent } from './positions-panel.component';
import type { PositionRow } from './positions.view';

/**
 * T-045/T-046 (the user's feedback, item 12) — the positions list as a dropdown from the toolbar
 * instead of an always-visible column: a button with the count of open and pending orders opens
 * the positions panel (instrument, direction, entry, stop, target, floating PnL, risk; cancel /
 * close as before). It stays open while orders are closed from it; Esc inside it or a click
 * outside closes it.
 */
@Component({
  selector: 'app-positions-dropdown',
  standalone: true,
  imports: [PositionsPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './positions-dropdown.component.html',
  styleUrl: './positions-dropdown.component.scss',
})
export class PositionsDropdownComponent {
  readonly rows = input.required<readonly PositionRow[]>();
  readonly currency = input.required<string>();
  readonly pricePrecision = input<ReadonlyMap<string, number>>(new Map());

  readonly cancel = output<string>();
  readonly close = output<string>();

  readonly open = signal(false);
  readonly count = computed(() => this.rows().length);
  readonly openCount = computed(() => this.rows().filter((r) => r.order.status === 'open').length);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * A mouse click hands focus back to the page, so the workspace hotkeys (Enter included) act on
   * the chart again at once; a keyboard user who tabbed here keeps focus on the toggle.
   */
  toggle(event?: MouseEvent): void {
    this.open.update((o) => !o);
    if (event && event.detail > 0) (event.currentTarget as HTMLElement | null)?.blur();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }
}

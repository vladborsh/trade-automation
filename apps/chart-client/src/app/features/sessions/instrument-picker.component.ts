import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import type { BacktestInstrument, InstrumentId } from '@trade-automation/contracts';
import type { InstrumentGroup } from './instrument-groups';
import { filterGroups, nextActive, optionIds, toggled } from './instrument-options';
import { MAX_SESSION_PANELS } from './session-layout';
import { formatUtcMinute } from './session-format';

/**
 * The create form's instrument picker (§7.2, decisions 16, 36), a dropdown multiselect since T-039:
 * a trigger showing the chosen instruments as removable chips, and a popup with a search box and the
 * instruments with stored 1m, grouped by session currency. Keyboard: Enter/Space/ArrowDown open;
 * ArrowUp/ArrowDown move; Enter toggles; Escape closes. Presentational: it emits the new selection
 * and leaves the one-currency rule to the form's validation, which blocks submit and says why.
 */
@Component({
  selector: 'app-instrument-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './instrument-picker.component.html',
  styleUrl: './instrument-picker.component.scss',
  host: { '(document:click)': 'onDocumentClick($event)' },
})
export class InstrumentPickerComponent {
  readonly groups = input.required<InstrumentGroup[]>();
  readonly selected = input.required<InstrumentId[]>();
  readonly selectedChange = output<InstrumentId[]>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly search = viewChild<ElementRef<HTMLInputElement>>('search');

  readonly open = signal(false);
  readonly query = signal('');
  readonly active = signal<InstrumentId | null>(null);

  readonly max = MAX_SESSION_PANELS;
  readonly full = computed(() => this.selected().length >= MAX_SESSION_PANELS);
  readonly shown = computed(() => filterGroups(this.groups(), this.query()));
  readonly byId = computed(() => new Map<InstrumentId, BacktestInstrument>(this.groups().flatMap((g) => g.instruments).map((i) => [i.id, i])));
  readonly chosen = computed(() => this.selected().map((id) => ({ id, name: this.byId().get(id)?.displayName ?? id })));
  readonly day = (ms: number) => formatUtcMinute(ms).slice(0, 10);

  isSelected(id: InstrumentId): boolean {
    return this.selected().includes(id);
  }

  isDisabled(id: InstrumentId): boolean {
    return this.full() && !this.isSelected(id);
  }

  optionDomId(id: InstrumentId): string {
    return `instrument-option-${id.replace(/[^a-zA-Z0-9]/g, '-')}`;
  }

  toggle(id: InstrumentId): void {
    if (this.isDisabled(id)) return;
    this.selectedChange.emit(toggled(this.selected(), id, MAX_SESSION_PANELS));
  }

  remove(id: InstrumentId, event: Event): void {
    event.stopPropagation();
    this.selectedChange.emit(this.selected().filter((s) => s !== id));
  }

  openPanel(): void {
    if (this.open()) return;
    this.open.set(true);
    this.active.set(null);
    // After the panel has rendered: a microtask would run before change detection creates the input.
    afterNextRender(() => this.search()?.nativeElement.focus(), { injector: this.injector });
  }

  close(returnFocus: boolean): void {
    this.open.set(false);
    this.query.set('');
    if (returnFocus) this.trigger()?.nativeElement.focus();
  }

  onTriggerKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.openPanel();
    }
  }

  onSearchKeydown(event: KeyboardEvent): void {
    const ids = optionIds(this.shown());
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.active.set(nextActive(ids, this.active(), event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const id = this.active();
      if (id !== null && ids.includes(id)) this.toggle(id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.close(true);
    } else if (event.key === 'Tab') {
      this.close(false);
    }
  }

  onQuery(value: string): void {
    this.query.set(value);
    this.active.set(optionIds(this.shown())[0] ?? null);
  }

  onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.close(false);
  }
}

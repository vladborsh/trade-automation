import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { InstrumentId } from '@trade-automation/contracts';
import type { InstrumentGroup } from './instrument-groups';
import { MAX_SESSION_PANELS } from './session-layout';
import { formatUtcMinute } from './session-format';

/**
 * The create form's instrument picker (§7.2, decisions 16, 36): instruments with stored 1m,
 * grouped by session currency. Presentational: it emits the new selection and leaves the
 * one-currency rule to the form's validation, which blocks submit and says why.
 */
@Component({
  selector: 'app-instrument-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './instrument-picker.component.html',
  styleUrl: './instrument-picker.component.scss',
})
export class InstrumentPickerComponent {
  readonly groups = input.required<InstrumentGroup[]>();
  readonly selected = input.required<InstrumentId[]>();
  readonly selectedChange = output<InstrumentId[]>();

  readonly full = computed(() => this.selected().length >= MAX_SESSION_PANELS);
  readonly max = MAX_SESSION_PANELS;
  readonly day = (ms: number) => formatUtcMinute(ms).slice(0, 10);

  isSelected(id: InstrumentId): boolean {
    return this.selected().includes(id);
  }

  toggle(id: InstrumentId, checked: boolean): void {
    const current = this.selected();
    this.selectedChange.emit(checked ? (current.includes(id) ? current : [...current, id]) : current.filter((i) => i !== id));
  }
}

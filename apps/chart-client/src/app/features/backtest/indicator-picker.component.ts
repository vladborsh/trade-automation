import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type { SessionPanel, SessionPanelIndicator } from '@trade-automation/contracts';
import { indicatorById, type IndicatorCatalogEntry } from '@trade-automation/indicators';
import { CATALOG, acceptParam, effectiveParams, indicatorLabel, newIndicator } from '../../core/replay/panel-indicators';

/**
 * T-028 — one panel's indicators from the `libs/indicators` catalogue: add, remove and edit
 * parameters. Presentational: every change emits the panel's new `indicators` list, which the
 * layout editor persists with one `PATCH {layout}`. A parameter outside the catalogue's bounds is
 * refused here, with a message, and never sent.
 */
@Component({
  selector: 'app-indicator-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './indicator-picker.component.html',
  styleUrl: './indicator-picker.component.scss',
})
export class IndicatorPickerComponent {
  readonly panel = input.required<SessionPanel>();
  readonly disabled = input(false);
  readonly indicatorsChange = output<SessionPanelIndicator[]>();

  readonly catalog = CATALOG;
  readonly choice = signal('');
  readonly error = signal<string | null>(null);

  /** The panel's indicators with their catalogue entry and effective params (unknown ids are kept but shown as such). */
  readonly rows = computed(() =>
    (this.panel().indicators ?? []).map((ind, index) => {
      const entry = indicatorById(ind.id) ?? null;
      const params = entry ? effectiveParams(entry, ind.params) : {};
      return { index, id: ind.id, entry, params, label: entry ? indicatorLabel(entry, params) : `${ind.id} (unknown)` };
    }),
  );

  add(): void {
    const created = newIndicator(this.choice());
    if (!created) return;
    this.error.set(null);
    this.choice.set('');
    this.indicatorsChange.emit([...(this.panel().indicators ?? []), created]);
  }

  remove(index: number): void {
    this.error.set(null);
    this.indicatorsChange.emit((this.panel().indicators ?? []).filter((_, i) => i !== index));
  }

  setParam(index: number, entry: IndicatorCatalogEntry, key: string, raw: string): void {
    const value = acceptParam(entry, key, raw);
    const spec = entry.params.find((p) => p.key === key)!;
    if (value === null) {
      this.error.set(`${spec.label} must be ${spec.integer ? 'a whole number' : 'a number'} from ${spec.min} to ${spec.max}.`);
      return;
    }
    this.error.set(null);
    this.indicatorsChange.emit(
      (this.panel().indicators ?? []).map((ind, i) => (i === index ? { ...ind, params: { ...ind.params, [key]: value } } : ind)),
    );
  }
}

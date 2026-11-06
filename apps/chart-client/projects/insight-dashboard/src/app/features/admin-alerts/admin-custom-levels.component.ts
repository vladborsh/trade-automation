import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import type { CustomLevelEvent, WebCustomLevelsResponse } from '@trade-automation/contracts';
import { InsightApiClient } from '../../core/insight-api.client';
import type { StringKey } from '../../i18n/keys';
import { I18nService } from '../../i18n/i18n.service';
import { CUSTOM_EVENT_COLUMNS, createBody, customLevelErrorKey, toCustomLevelRow, type CustomLevelForm } from './custom-level-rows';

/**
 * IB-128 (architecture/alerts-liq-funding-levels-design-2026-11-05.md §4 P9) — the owner's custom levels inside the
 * «Levels» section of `/admin/alerts`: add one (coin, price, note), switch its four events, delete it (softly; a
 * second click confirms). Every write answers with the active list, which replaces the block's.
 */
@Component({
  selector: 'app-admin-custom-levels',
  standalone: true,
  templateUrl: './admin-custom-levels.component.html',
  styleUrl: './admin-custom-levels.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminCustomLevelsComponent {
  private readonly api = inject(InsightApiClient);
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);
  readonly columns = CUSTOM_EVENT_COLUMNS;

  /** The coins a level can be added for: the alert list, from the «Levels» section. */
  readonly symbols = input<readonly string[]>([]);

  readonly list = signal<WebCustomLevelsResponse | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly actionError = signal<StringKey | null>(null);
  readonly form = signal<CustomLevelForm>({ symbol: '', price: '', note: '' });
  /** The level whose delete button was clicked once and now asks to be clicked again. */
  readonly confirming = signal<number | null>(null);

  readonly rows = computed(() => (this.list()?.levels ?? []).map(toCustomLevelRow));
  readonly body = computed(() => createBody({ ...this.form(), symbol: this.form().symbol || (this.symbols()[0] ?? '') }));
  readonly priceBad = computed(() => this.form().price.trim() !== '' && this.body() === null);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loadError.set(null);
    try {
      this.list.set(await this.api.customLevels());
    } catch (error) {
      this.loadError.set((error as Error).message);
    }
  }

  edit(field: keyof CustomLevelForm, value: string): void {
    this.form.update((f) => ({ ...f, [field]: value }));
  }

  async add(): Promise<void> {
    const body = this.body();
    if (!body) return;
    if (await this.write(() => this.api.addCustomLevel(body))) this.form.update((f) => ({ ...f, price: '', note: '' }));
  }

  setEvent(id: number, event: CustomLevelEvent, on: boolean): Promise<boolean> {
    return this.write(() => this.api.patchCustomLevel(id, { events: { [event]: on } }));
  }

  async remove(id: number): Promise<void> {
    if (this.confirming() !== id) {
      this.confirming.set(id);
      return;
    }
    this.confirming.set(null);
    await this.write(() => this.api.deleteCustomLevel(id));
  }

  private async write(call: () => Promise<WebCustomLevelsResponse>): Promise<boolean> {
    if (this.busy()) return false;
    this.busy.set(true);
    this.actionError.set(null);
    try {
      this.list.set(await call());
      return true;
    } catch (error) {
      this.actionError.set(customLevelErrorKey(error));
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}

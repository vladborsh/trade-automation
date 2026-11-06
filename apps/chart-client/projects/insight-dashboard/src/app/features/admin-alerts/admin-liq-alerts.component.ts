import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { WebLiqAlertSettingsPatch, WebLiqAlertsAdminResponse } from '@trade-automation/contracts';
import { InsightApiClient } from '../../core/insight-api.client';
import type { StringKey } from '../../i18n/keys';
import { I18nService } from '../../i18n/i18n.service';
import { atMinute } from './alert-rows';
import { coinsToForm, perCoinPatch, toLiqRow, type LiqCoinForm } from './liq-rows';
import { TimePipe } from '../../shared/time.pipe';

/**
 * IB-122 (architecture/alerts-liq-funding-levels-design-2026-11-05.md §1, L4) — the «Large liquidations»
 * section of `/admin/alerts`: the type's two switches (sending, default off; members' toggle, default
 * off), a threshold and a switch per coin of the shared alert list, and the last 50 journal rows. Every
 * write answers with the whole section, which replaces it.
 */
@Component({
  selector: 'app-admin-liq-alerts',
  standalone: true,
  imports: [TimePipe],
  templateUrl: './admin-liq-alerts.component.html',
  styleUrl: './admin-liq-alerts.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminLiqAlertsComponent {
  private readonly api = inject(InsightApiClient);
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly page = signal<WebLiqAlertsAdminResponse | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly actionError = signal<StringKey | null>(null);
  readonly form = signal<LiqCoinForm[]>([]);
  /** The coins that changed, as the PATCH body; null while a changed row cannot be saved. */
  readonly patch = computed(() => {
    const p = this.page();
    return p ? perCoinPatch(this.form(), p.coins) : {};
  });
  readonly changed = computed(() => {
    const p = this.patch();
    return p !== null && Object.keys(p).length > 0;
  });
  readonly alerts = computed(() => (this.page()?.alerts ?? []).map(toLiqRow));
  readonly updated = computed(() => {
    const s = this.page()?.settings;
    return s ? atMinute(s.updatedAt) : '';
  });

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loadError.set(null);
    try {
      this.show(await this.api.liqAlertsAdmin());
    } catch (error) {
      this.loadError.set((error as Error).message);
    }
  }

  setSwitch(field: 'enabled' | 'membersVisible', on: boolean): Promise<void> {
    return this.write({ [field]: on } as WebLiqAlertSettingsPatch);
  }

  edit(symbol: string, field: 'enabled' | 'threshold', value: boolean | string): void {
    this.form.update((rows) => rows.map((r) => (r.symbol === symbol ? { ...r, [field]: value } : r)));
  }

  save(): Promise<void> {
    const perCoin = this.patch();
    return perCoin === null || Object.keys(perCoin).length === 0 ? Promise.resolve() : this.write({ perCoin });
  }

  reset(): void {
    const p = this.page();
    if (p) this.form.set(coinsToForm(p.coins));
  }

  private show(page: WebLiqAlertsAdminResponse): void {
    this.page.set(page);
    this.form.set(coinsToForm(page.coins));
  }

  private async write(patch: WebLiqAlertSettingsPatch): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.actionError.set(null);
    try {
      this.show(await this.api.patchLiqAlerts(patch));
    } catch {
      this.actionError.set('alerts.failed');
    } finally {
      this.busy.set(false);
    }
  }
}

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { OI_DIVERGENCE_TFS, type WebAlertSettingsPatch, type WebAlertsAdminResponse } from '@trade-automation/contracts';
import { ApiError } from '@backtest-core/api/api-error';
import { InsightApiClient } from '../../core/insight-api.client';
import type { StringKey } from '../../i18n/keys';
import { I18nService } from '../../i18n/i18n.service';
import { AdminLiqAlertsComponent } from './admin-liq-alerts.component';
import { AdminFundingAlertsComponent } from './admin-funding-alerts.component';
import { formToParams, normalizeSymbol, paramsToForm, symbolRefusalKey, toAlertRow, toSkipRow, utcMinute, type ParamsForm } from './alert-rows';

/**
 * IB-112 (architecture/oi-divergence-design-2026-11-04.md V13, V17) — the admin page for OI
 * divergence alerts: the two switches (send to Telegram; let members see the toggle), the coin list,
 * the detector's params per TF, and the last 50 journal rows and skips. Admin only (route guard; the
 * server answers 403 to a member anyway). Every write answers with the whole page, which replaces it.
 */
@Component({
  selector: 'app-admin-alerts',
  standalone: true,
  imports: [AdminLiqAlertsComponent, AdminFundingAlertsComponent],
  templateUrl: './admin-alerts.component.html',
  styleUrl: './admin-alerts.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminAlertsComponent {
  private readonly api = inject(InsightApiClient);
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);
  readonly tfs = OI_DIVERGENCE_TFS;

  readonly page = signal<WebAlertsAdminResponse | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly actionError = signal<StringKey | null>(null);
  readonly newSymbol = signal('');
  /** The coin waiting for «Удалить?» confirmation, or null. */
  readonly confirmingRemove = signal<string | null>(null);
  readonly form = signal<ParamsForm | null>(null);
  /** The form parsed by the contract: null while any field is not a valid number. */
  readonly parsedParams = computed(() => {
    const f = this.form();
    return f === null ? null : formToParams(f);
  });
  readonly paramsChanged = computed(() => {
    const p = this.parsedParams();
    return p !== null && JSON.stringify(p) !== JSON.stringify(this.page()?.settings.params);
  });
  readonly alerts = computed(() => (this.page()?.alerts ?? []).map(toAlertRow));
  readonly skips = computed(() => (this.page()?.skips ?? []).map(toSkipRow));
  readonly updated = computed(() => {
    const s = this.page()?.settings;
    return s ? utcMinute(s.updatedAt) : '';
  });

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.show(await this.api.alertsAdmin());
    } catch (error) {
      this.loadError.set((error as Error).message);
    } finally {
      this.loading.set(false);
    }
  }

  setSwitch(field: 'enabled' | 'membersVisible', on: boolean): Promise<void> {
    return this.write(() => this.api.patchAlertSettings({ [field]: on } as WebAlertSettingsPatch));
  }

  saveParams(): Promise<void> {
    const params = this.parsedParams();
    return params === null ? Promise.resolve() : this.write(() => this.api.patchAlertSettings({ params }));
  }

  resetParams(): void {
    const p = this.page();
    if (p) this.form.set(paramsToForm(p.settings.params));
  }

  editParam(tf: string | null, field: string, value: string): void {
    this.form.update((f) => {
      if (f === null) return f;
      if (tf === null) return { ...f, [field]: value };
      const key = tf as keyof ParamsForm['perTf'];
      return { ...f, perTf: { ...f.perTf, [key]: { ...f.perTf[key], [field]: value } } };
    });
  }

  /** IB-144 (V42): the per-TF «скрытые» checkbox — whether that TF's hidden alerts are sent. */
  editSendHidden(tf: keyof ParamsForm['perTf'], on: boolean): void {
    this.form.update((f) => (f === null ? f : { ...f, perTf: { ...f.perTf, [tf]: { ...f.perTf[tf], sendHidden: on } } }));
  }

  addSymbol(): Promise<void> {
    const symbol = normalizeSymbol(this.newSymbol());
    if (symbol === '') return Promise.resolve();
    return this.write(() => this.api.addAlertSymbol(symbol), () => this.newSymbol.set(''));
  }

  setSymbolEnabled(symbol: string, enabled: boolean): Promise<void> {
    return this.write(() => this.api.setAlertSymbolEnabled(symbol, enabled));
  }

  askRemove(symbol: string): void {
    this.actionError.set(null);
    this.confirmingRemove.set(symbol);
  }

  cancelRemove(): void {
    this.confirmingRemove.set(null);
  }

  removeSymbol(symbol: string): Promise<void> {
    return this.write(() => this.api.removeAlertSymbol(symbol), () => this.confirmingRemove.set(null));
  }

  private show(page: WebAlertsAdminResponse): void {
    this.page.set(page);
    this.form.set(paramsToForm(page.settings.params));
  }

  private async write(call: () => Promise<WebAlertsAdminResponse>, after?: () => void): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.actionError.set(null);
    try {
      this.show(await call());
      after?.();
    } catch (error) {
      this.actionError.set(error instanceof ApiError && error.status === 409 ? symbolRefusalKey(error.code) : 'alerts.failed');
    } finally {
      this.busy.set(false);
    }
  }
}

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { WebFundingAlertSettingsPatch, WebFundingAlertsAdminResponse } from '@trade-automation/contracts';
import { InsightApiClient } from '../../core/insight-api.client';
import type { StringKey } from '../../i18n/keys';
import { I18nService } from '../../i18n/i18n.service';
import { utcMinute } from './alert-rows';
import { coinsToFundingForm, floorText, fundingPerCoinPatch, parseHours, toFundingRow, type FundingCoinForm } from './funding-rows';

/**
 * IB-124 (architecture/alerts-liq-funding-levels-design-2026-11-05.md §1, F3, F5) — the «Funding» section of
 * `/admin/alerts`. It holds the type's two switches (sending, default off; members' toggle, default off), F5's two
 * bounds, a switch and an optional floor per coin of the shared list (empty = the shared default, shown), and the last
 * 50 journal rows. Every write answers with the whole section, which replaces it.
 */
@Component({
  selector: 'app-admin-funding-alerts',
  standalone: true,
  templateUrl: './admin-funding-alerts.component.html',
  styleUrl: './admin-funding-alerts.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminFundingAlertsComponent {
  private readonly api = inject(InsightApiClient);
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly page = signal<WebFundingAlertsAdminResponse | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly actionError = signal<StringKey | null>(null);
  readonly form = signal<FundingCoinForm[]>([]);
  readonly minEpisode = signal('');
  readonly flipWithin = signal('');

  readonly defaultFloor = computed(() => {
    const p = this.page();
    return p ? floorText(p.defaultFloorPer8h) : '';
  });
  /** The PATCH body of everything changed; null while something changed cannot be saved. */
  readonly patch = computed((): WebFundingAlertSettingsPatch | Record<string, never> | null => {
    const p = this.page();
    if (!p) return {};
    const perCoin = fundingPerCoinPatch(this.form(), p.coins);
    const min = parseHours(this.minEpisode());
    const flip = parseHours(this.flipWithin());
    if (perCoin === null || min === null || flip === null) return null;
    return {
      ...(Object.keys(perCoin).length > 0 ? { perCoin } : {}),
      ...(min !== p.settings.params.minEpisodeHours ? { minEpisodeHours: min } : {}),
      ...(flip !== p.settings.params.flipWithinHours ? { flipWithinHours: flip } : {}),
    };
  });
  readonly changed = computed(() => {
    const p = this.patch();
    return p !== null && Object.keys(p).length > 0;
  });
  readonly alerts = computed(() => (this.page()?.alerts ?? []).map(toFundingRow));
  readonly updated = computed(() => {
    const s = this.page()?.settings;
    return s ? utcMinute(s.updatedAt) : '';
  });

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loadError.set(null);
    try {
      this.show(await this.api.fundingAlertsAdmin());
    } catch (error) {
      this.loadError.set((error as Error).message);
    }
  }

  setSwitch(field: 'enabled' | 'membersVisible', on: boolean): Promise<void> {
    return this.write({ [field]: on } as WebFundingAlertSettingsPatch);
  }

  edit(symbol: string, field: 'enabled' | 'floor', value: boolean | string): void {
    this.form.update((rows) => rows.map((r) => (r.symbol === symbol ? { ...r, [field]: value } : r)));
  }

  save(): Promise<void> {
    const p = this.patch();
    return p === null || Object.keys(p).length === 0 ? Promise.resolve() : this.write(p as WebFundingAlertSettingsPatch);
  }

  reset(): void {
    const p = this.page();
    if (p) this.show(p);
  }

  private show(page: WebFundingAlertsAdminResponse): void {
    this.page.set(page);
    this.form.set(coinsToFundingForm(page.coins));
    this.minEpisode.set(String(page.settings.params.minEpisodeHours));
    this.flipWithin.set(String(page.settings.params.flipWithinHours));
  }

  private async write(patch: WebFundingAlertSettingsPatch): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.actionError.set(null);
    try {
      this.show(await this.api.patchFundingAlerts(patch));
    } catch {
      this.actionError.set('alerts.failed');
    } finally {
      this.busy.set(false);
    }
  }
}

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { LEVEL_EVENTS, type LevelKind, type WebLevelAlertSettingsPatch, type WebLevelAlertsAdminResponse } from '@trade-automation/contracts';
import { InsightApiClient } from '../../core/insight-api.client';
import type { StringKey } from '../../i18n/keys';
import { I18nService } from '../../i18n/i18n.service';
import { utcMinute } from './alert-rows';
import {
  LEVEL_EVENT_KEY, bandText, coinsToLevelForm, eventGrid, eventsPatch, levelPerCoinPatch, parseBandPct, toLevelRow, type EventGridRow,
  type LevelCoinForm,
} from './level-rows';

/**
 * IB-126 (architecture/alerts-liq-funding-levels-design-2026-11-05.md §1, P2, P7, P10) — the «Levels» section of
 * `/admin/alerts`. It holds the type's two switches (sending, default off; members' toggle, default off), the touch
 * band, a switch per level kind and event, per coin its switch and PDH/PDL (off by default) with whether its state is
 * seeded, and the last 50 journal rows. Every write answers with the whole section, which replaces it.
 */
@Component({
  selector: 'app-admin-level-alerts',
  standalone: true,
  templateUrl: './admin-level-alerts.component.html',
  styleUrl: './admin-level-alerts.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminLevelAlertsComponent {
  private readonly api = inject(InsightApiClient);
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);
  readonly eventColumns = LEVEL_EVENTS.map((e) => LEVEL_EVENT_KEY[e]);

  readonly page = signal<WebLevelAlertsAdminResponse | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly actionError = signal<StringKey | null>(null);
  readonly coins = signal<LevelCoinForm[]>([]);
  readonly grid = signal<EventGridRow[]>([]);
  readonly band = signal('');

  /** The PATCH body of everything changed; null while the band cannot be saved. */
  readonly patch = computed((): WebLevelAlertSettingsPatch | Record<string, never> | null => {
    const p = this.page();
    if (!p) return {};
    const touchBand = parseBandPct(this.band());
    if (touchBand === null) return null;
    const perCoin = levelPerCoinPatch(this.coins(), p.coins);
    const events = eventsPatch(this.grid(), p.events);
    return {
      ...(Object.keys(perCoin).length > 0 ? { perCoin } : {}),
      ...(Object.keys(events).length > 0 ? { events } : {}),
      ...(touchBand !== p.settings.params.touchBand ? { touchBand } : {}),
    };
  });
  readonly changed = computed(() => {
    const p = this.patch();
    return p !== null && Object.keys(p).length > 0;
  });
  readonly alerts = computed(() => (this.page()?.alerts ?? []).map(toLevelRow));
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
      this.show(await this.api.levelAlertsAdmin());
    } catch (error) {
      this.loadError.set((error as Error).message);
    }
  }

  setSwitch(field: 'enabled' | 'membersVisible', on: boolean): Promise<void> {
    return this.write({ [field]: on } as WebLevelAlertSettingsPatch);
  }

  editCoin(symbol: string, field: 'enabled' | 'daily', on: boolean): void {
    this.coins.update((rows) => rows.map((r) => (r.symbol === symbol ? { ...r, [field]: on } : r)));
  }

  editEvent(kind: LevelKind, column: number, on: boolean): void {
    this.grid.update((rows) => rows.map((r) => (r.kind !== kind ? r : { ...r, cells: r.cells.map((c, i) => (i === column && c ? { ...c, on } : c)) })));
  }

  save(): Promise<void> {
    const p = this.patch();
    return p === null || Object.keys(p).length === 0 ? Promise.resolve() : this.write(p as WebLevelAlertSettingsPatch);
  }

  reset(): void {
    const p = this.page();
    if (p) this.show(p);
  }

  private show(page: WebLevelAlertsAdminResponse): void {
    this.page.set(page);
    this.coins.set(coinsToLevelForm(page.coins));
    this.grid.set(eventGrid(page.events));
    this.band.set(bandText(page.settings.params.touchBand));
  }

  private async write(patch: WebLevelAlertSettingsPatch): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.actionError.set(null);
    try {
      this.show(await this.api.patchLevelAlerts(patch));
    } catch {
      this.actionError.set('alerts.failed');
    } finally {
      this.busy.set(false);
    }
  }
}

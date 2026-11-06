import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { WebMemberSettings, WebMemberSettingsPatch } from '@trade-automation/contracts';
import { InsightApiClient } from '../../core/insight-api.client';
import { SessionService } from '../../core/session.service';
import type { StringKey } from '../../i18n/keys';
import { I18nService } from '../../i18n/i18n.service';

/**
 * IB-035 — a member's own settings on the site: the language and the calendar reminders in Telegram
 * (owner, 2026-11-04: they stay), and (IB-112) the OI alerts when the server says they are visible.
 * Exactly the bot's `/lang`, `/calendar` and `/oialerts`. They share one column,
 * so a change here changes the bot's answers too. A language change switches the interface at once.
 */
@Component({
  selector: 'app-member-settings',
  standalone: true,
  templateUrl: './member-settings.component.html',
  styleUrl: './member-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemberSettingsComponent {
  private readonly api = inject(InsightApiClient);
  private readonly i18n = inject(I18nService);
  private readonly session = inject(SessionService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly settings = signal<WebMemberSettings | null>(null);
  readonly busy = signal(false);
  readonly status = signal<StringKey | null>(null);

  constructor() {
    void this.api.memberSettings().then((s) => this.settings.set(s)).catch(() => this.status.set('settings.loadFailed'));
  }

  setLang(lang: string): void {
    void this.save({ lang });
  }

  setCalendar(on: boolean): void {
    void this.save({ calendarAlerts: on });
  }

  /** IB-112 (V13): OI divergence alerts in Telegram — offered only while the server says this member may see it. */
  setOiAlerts(on: boolean): void {
    void this.save({ oiAlerts: on });
  }

  /** IB-122: large-liquidation alerts — offered only while the server says this member may see them. */
  setLiqAlerts(on: boolean): void {
    void this.save({ liqAlerts: on });
  }

  /** IB-124: funding alerts — offered only while the server says this member may see them. */
  setFundingAlerts(on: boolean): void {
    void this.save({ fundingAlerts: on });
  }

  /** IB-126: price-level alerts — offered only while the server says this member may see them. */
  setLevelAlerts(on: boolean): void {
    void this.save({ levelAlerts: on });
  }

  private async save(patch: WebMemberSettingsPatch): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.status.set(null);
    try {
      const saved = await this.api.updateMemberSettings(patch);
      this.settings.set(saved);
      this.i18n.setLang(saved.lang);
      const user = this.session.user();
      if (user && user.lang !== saved.lang) this.session.signedIn({ ...user, lang: saved.lang });
      this.status.set('settings.saved');
    } catch {
      this.status.set('settings.saveFailed');
    } finally {
      this.busy.set(false);
    }
  }
}

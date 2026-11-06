import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { WebLoginEvent } from '@trade-automation/contracts';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import { toLoginEventRow } from './login-event-rows';
import { TimePipe } from '../../shared/time.pipe';

/**
 * IB-079 (password-login design P10) — the login journal, admin only (route guard + nav link, the
 * IB-075 pattern; the server answers 403 to a member regardless). The last 200, no polling: a
 * refresh button, because the journal is read when something looks wrong, not watched.
 */
@Component({
  selector: 'app-admin-logins',
  standalone: true,
  imports: [TimePipe],
  templateUrl: './admin-logins.component.html',
  styleUrl: './admin-logins.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminLoginsComponent {
  private readonly api = inject(InsightApiClient);
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  private readonly events = signal<WebLoginEvent[]>([]);
  readonly rows = computed(() => this.events().map((e) => toLoginEventRow(e)));
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.events.set((await this.api.loginEvents(200)).events);
    } catch (error) {
      this.error.set((error as Error).message);
    } finally {
      this.loading.set(false);
    }
  }
}

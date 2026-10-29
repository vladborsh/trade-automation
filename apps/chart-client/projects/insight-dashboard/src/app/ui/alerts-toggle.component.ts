import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CalendarAlertsService } from '../core/calendar-alerts.service';
import { I18nService } from '../i18n/i18n.service';

/**
 * IB-061 — the header switch for browser notifications before high-impact USD events. Turning it
 * on asks the browser's permission; the hint says the one limit that matters: it works only while
 * a dashboard tab is open.
 */
@Component({
  selector: 'app-alerts-toggle',
  standalone: true,
  templateUrl: './alerts-toggle.component.html',
  styleUrl: './alerts-toggle.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertsToggleComponent {
  private readonly alerts = inject(CalendarAlertsService);
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly active = this.alerts.active;
  /** The browser refuses (blocked in its settings, or no Notification API): the switch cannot help. */
  readonly blocked = computed(() => this.alerts.permission() === 'denied' || this.alerts.permission() === 'unsupported');
  readonly label = computed(() => this.t(this.active() ? 'alerts.toggle.on' : 'alerts.toggle.off'));
  readonly hint = computed(() => {
    const permission = this.alerts.permission();
    if (permission === 'denied') return this.t('alerts.toggle.denied');
    if (permission === 'unsupported') return this.t('alerts.toggle.unsupported');
    return this.t('alerts.toggle.hint');
  });

  toggle(): void {
    void this.alerts.toggle();
  }
}

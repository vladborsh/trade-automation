import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { CalendarAlertsService } from './core/calendar-alerts.service';
import { I18nService } from './i18n/i18n.service';
import { AlertsToggleComponent } from './ui/alerts-toggle.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AlertsToggleComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly i18n = inject(I18nService);
  /** §11: every string comes from the table; `t` is how a template reaches it. */
  readonly t = this.i18n.t.bind(this.i18n);

  constructor() {
    // IB-061: app-wide, so an alert rings on whichever page the member has open
    inject(CalendarAlertsService).start();
  }
}

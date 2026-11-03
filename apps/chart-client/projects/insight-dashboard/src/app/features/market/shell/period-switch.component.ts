import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { WEB_MARKET_PERIODS, type WebMarketPeriod } from '@trade-automation/contracts';
import { I18nService } from '../../../i18n/i18n.service';
import type { StringKey } from '../../../i18n/keys';
import { periodAvailability } from './market-text';

/**
 * IB-088 (D14) — the page-wide period switch. A period whose block has no full window of tape yet is
 * disabled and says from when (`availableFrom`). Buttons are ≥ 40 px tall (phone acceptance).
 */
@Component({
  selector: 'app-period-switch',
  standalone: true,
  templateUrl: './period-switch.component.html',
  styleUrl: './period-switch.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PeriodSwitchComponent {
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly period = input.required<WebMarketPeriod>();
  readonly availableFrom = input<Partial<Record<WebMarketPeriod, number | null>> | null>(null);
  readonly nowSec = input<number>(Math.floor(Date.now() / 1000));
  readonly periodChange = output<WebMarketPeriod>();

  readonly periods = WEB_MARKET_PERIODS;

  label(p: WebMarketPeriod): string {
    return this.t(`market.period.${p}` as StringKey);
  }

  availability(p: WebMarketPeriod): { available: boolean; fromDay: string | null } {
    return periodAvailability(this.availableFrom(), p, this.nowSec());
  }

  /** The disabled button's title: from which day the period has a full window. */
  hint(p: WebMarketPeriod): string | null {
    const day = this.availability(p).fromDay;
    return day ? this.t('market.period.availableFrom', { date: day }) : null;
  }

  /** The one visible line, for 7d only: the period a first-week reader will reach for. */
  readonly weekNote = computed(() => {
    const a = this.availability('7d');
    return a.available ? null : `${this.label('7d')}: ${this.t('market.period.availableFrom', { date: a.fromDay ?? '' })}`;
  });

  pick(p: WebMarketPeriod): void {
    if (p !== this.period() && this.availability(p).available) this.periodChange.emit(p);
  }
}

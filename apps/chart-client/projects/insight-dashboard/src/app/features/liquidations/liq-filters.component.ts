import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import {
  WEB_LIQUIDATIONS_LARGE_MIN_USD, WEB_LIQUIDATIONS_LARGE_PERIODS, WEB_LIQUIDATION_VENUES, venueName,
  type WebLiquidationsLargeMinUsd, type WebLiquidationsLargePeriod, type WebLiquidationsLargeQuery,
} from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import type { StringKey } from '../../i18n/keys';
import { formatUsd } from './liquidations.format';

/**
 * IB-120 (market-round2 design §4) — the /liquidations filter chips, in the mockup's order:
 * period `24h | 7d`, coin, minimum `$100K | $1M`, side (longs / shorts; neither = both), venue.
 * Emits a patch of the query; the page owns the state and the URL.
 */
@Component({
  selector: 'app-liq-filters',
  standalone: true,
  templateUrl: './liq-filters.component.html',
  styleUrl: './liq-filters.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiqFiltersComponent {
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly query = input.required<WebLiquidationsLargeQuery>();
  /** The coins of the period (the response's `coins`); the chosen one is kept even if it has no rows. */
  readonly coins = input<ReadonlyArray<{ symbol: string; base: string }>>([]);
  readonly queryChange = output<Partial<WebLiquidationsLargeQuery>>();

  readonly periods = WEB_LIQUIDATIONS_LARGE_PERIODS;
  readonly mins = WEB_LIQUIDATIONS_LARGE_MIN_USD;
  readonly venues = WEB_LIQUIDATION_VENUES.map((key) => ({ key, name: venueName(key) }));
  readonly coinOptions = computed(() => {
    const chosen = this.query().symbol;
    const list = [...this.coins()];
    if (chosen !== 'all' && !list.some((c) => c.symbol === chosen)) list.push({ symbol: chosen, base: chosen.replace(/USDT$/, '') });
    return list;
  });

  periodLabel(p: WebLiquidationsLargePeriod): string {
    return this.t(`market.period.${p}` as StringKey);
  }

  minLabel(m: WebLiquidationsLargeMinUsd): string {
    return this.t('liqPage.filter.min', { usd: formatUsd(m) });
  }

  setPeriod(period: WebLiquidationsLargePeriod): void {
    this.queryChange.emit({ period });
  }

  setMin(minUsd: WebLiquidationsLargeMinUsd): void {
    this.queryChange.emit({ minUsd });
  }

  /** A side chip toggles: on → that side only; tapped again → both. */
  toggleSide(side: 'long' | 'short'): void {
    this.queryChange.emit({ side: this.query().side === side ? 'all' : side });
  }

  setCoin(event: Event): void {
    this.queryChange.emit({ symbol: (event.target as HTMLSelectElement).value });
  }

  setVenue(event: Event): void {
    this.queryChange.emit({ venue: (event.target as HTMLSelectElement).value as WebLiquidationsLargeQuery['venue'] });
  }
}

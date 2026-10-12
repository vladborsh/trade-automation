import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type {
  WebLiquidationCoin, WebLiquidationWindowStats, WebLiquidationsOverviewResponse,
} from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import type { StringKey } from '../../i18n/keys';
import {
  cellIntensity, formatRatio, formatUsd, hasAnyFlow, leaning, sortByUrgency,
} from './liquidations.format';
import { venueNote } from './venue-note';

/**
 * IB-038 — «Где ликвидируют» (design §12.3), the table.
 *
 * Rows are the top-20 coins, columns 1 h / 4 h / 24 h, each cell shaded by its ratio and coloured
 * by the side taking the damage, sorted so a cascade floats to the top. A row links to that
 * coin's instrument page.
 *
 * **Coins with no flow at all are hidden rather than listed as zeros.** Twenty rows of `$0` is
 * not information, and on this tape that is most of the universe. The sort keeps coins that have
 * money but no norm yet — which is also most of them — visible below the ones that do.
 */
@Component({
  selector: 'app-liquidations-where',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './liquidations-where.component.html',
  styleUrl: './liquidations-where.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiquidationsWhereComponent {
  readonly coins = input.required<readonly WebLiquidationCoin[]>();
  readonly venues = input.required<WebLiquidationsOverviewResponse['venues']>();

  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly usd = formatUsd;
  readonly ratio = formatRatio;
  readonly intensity = cellIntensity;

  /** Only coins something happened to, loudest first. */
  readonly rows = computed(() => sortByUrgency(this.coins().filter(hasAnyFlow)));

  /** Column headers come from the first row, so they cannot disagree with the cells. */
  readonly columns = computed<readonly WebLiquidationWindowStats['window'][]>(
    () => this.coins()[0]?.windows.map((w) => w.window) ?? ['1h', '4h', '24h'],
  );

  readonly columnLabel = (w: string): string => this.t(`liq.window.${w}` as StringKey);

  /** Down colour when longs are being liquidated, up colour when shorts are — IB-031's rule. */
  readonly side = (w: WebLiquidationWindowStats): string => leaning(w);

  readonly missing = (): string | null => {
    const note = venueNote(this.venues());
    return note ? this.t(note.key, note.params) : null;
  };
}

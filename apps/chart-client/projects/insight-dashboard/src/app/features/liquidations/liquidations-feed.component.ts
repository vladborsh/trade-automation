import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { WebLiquidationFeedEvent, WebLiquidationsOverviewResponse } from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import { formatUsd } from './liquidations.format';
import { venueNote } from './venue-note';

/** §12.3's picker. Plain numbers, not translated: they are amounts, not prose (§11). */
export const FEED_THRESHOLDS = [50_000, 100_000, 500_000, 1_000_000] as const;

/**
 * IB-038 — «Крупные ликвидации» (design §12.3), the feed.
 *
 * Newest first, above a threshold the reader picks. The threshold is an `output`, not internal
 * state: the parent owns the query, so the component cannot get out of step with the data it is
 * handed — and IB-037's page can mount it without inheriting a fetch.
 */
@Component({
  selector: 'app-liquidations-feed',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './liquidations-feed.component.html',
  styleUrl: './liquidations-feed.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiquidationsFeedComponent {
  readonly events = input.required<readonly WebLiquidationFeedEvent[]>();
  readonly minUsd = input.required<number>();
  readonly venues = input.required<WebLiquidationsOverviewResponse['venues']>();
  readonly minUsdChange = output<number>();

  readonly thresholds = FEED_THRESHOLDS;

  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);
  readonly usd = formatUsd;

  /**
   * Wall-clock time of day, in the reader's own zone but always on a 24-hour clock.
   *
   * A feed answers "how long ago", and a member comparing it against a venue's own UI needs the
   * same clock they are reading there. The date is omitted on purpose: everything here is inside
   * the last 24 hours, so a date would be noise on every row.
   *
   * `hour12: false` rather than the locale's default: the first run rendered «10:15 AM» in a
   * Russian UI because the browser's locale was en-US, and every other time on this dashboard —
   * the chart axes, the health page — is 24-hour. A feed that disagrees with the chart beside it
   * about what time it is costs more than it saves.
   */
  readonly time = (event: WebLiquidationFeedEvent): string =>
    new Date(event.time * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

  /** Enough digits to be useful on a sub-cent coin without padding a four-figure one. */
  readonly price = (event: WebLiquidationFeedEvent): string =>
    event.price >= 1 ? event.price.toFixed(2) : event.price.toPrecision(3);

  readonly sideLabel = (event: WebLiquidationFeedEvent): string =>
    this.t(event.side === 'long' ? 'liq.side.longs' : 'liq.side.shorts');

  readonly missing = (): string | null => {
    const note = venueNote(this.venues());
    return note ? this.t(note.key, note.params) : null;
  };

  readonly pick = (value: number): void => this.minUsdChange.emit(value);
}

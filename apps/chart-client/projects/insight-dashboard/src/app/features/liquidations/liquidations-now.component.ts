import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import type { WebLiquidationWindowStats, WebLiquidationsOverviewResponse } from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import type { StringKey } from '../../i18n/keys';
import {
  basisLine, escalation, formatRatio, formatUsd, leaning, sideShare,
} from './liquidations.format';
import { presentNote, venueNote } from './venue-note';

/**
 * IB-038 — «Ликвидации сейчас» (design §12.1), the card.
 *
 * Standalone and input-only by agreement with dev-1: it reads no route and assumes nothing about
 * what sits above it, so IB-037's market page can mount it in its card grid without touching
 * anything inside.
 *
 * **It is built to look right when the numbers are thin, which is the normal case here.** On the
 * local tape most windows hold no liquidations and most ratios are null. So: amounts always
 * render (a measured `$0` is a fact), the long/short bar splits evenly rather than collapsing
 * when both sides are zero, and a missing «× от нормы» shows its reason instead of a dash that
 * would read as "normal".
 */
@Component({
  selector: 'app-liquidations-now',
  standalone: true,
  templateUrl: './liquidations-now.component.html',
  styleUrl: './liquidations-now.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiquidationsNowComponent {
  readonly windows = input.required<readonly WebLiquidationWindowStats[]>();
  readonly venues = input.required<WebLiquidationsOverviewResponse['venues']>();
  /** Events in no coin's row. Shown only when non-zero — normally it is (IB-BUG-011). */
  readonly unmappedRows = input(0);
  /**
   * IB-039's narrow variant: the same card under the instrument chart, laid out in a row
   * instead of a column. An input rather than a second component — §12.5 asks for "the same
   * component, reused", and two copies of this card would be two places for the «нет нормы»
   * rule to drift apart.
   */
  readonly narrow = input(false);
  /** Overridden on the instrument page, where «Ликвидации сейчас» would repeat the page. */
  readonly titleKey = input<StringKey>('liq.now.title');

  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly usd = formatUsd;
  readonly ratio = formatRatio;
  readonly escalation = escalation;
  readonly share = sideShare;

  readonly windowLabel = (w: WebLiquidationWindowStats): string =>
    this.t(`liq.window.${w.window}` as StringKey);

  readonly leaningLine = (w: WebLiquidationWindowStats): string =>
    this.t(`liq.leaning.${leaning(w)}` as StringKey);

  /** The sample behind «× от нормы», or the reason there is none. Always shown (§12.2). */
  readonly basis = (w: WebLiquidationWindowStats): string => {
    const line = basisLine(w.basis, this.windowLabel(w));
    return this.t(line.key, line.params);
  };

  readonly missing = (): string | null => {
    const note = venueNote(this.venues());
    return note ? this.t(note.key, note.params) : null;
  };

  readonly sources = (): string | null => {
    const note = presentNote(this.venues());
    return note ? this.t(note.key, note.params) : null;
  };
}

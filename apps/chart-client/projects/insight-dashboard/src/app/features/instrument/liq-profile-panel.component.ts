import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { venueName } from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import { LoaderComponent } from '../../ui/loader.component';
import { formatUsd } from '../liquidations/liquidations.format';
import { formatAmount } from './amount';
import { LiqProfileDetailComponent } from './liq-profile-detail.component';
import { bandDetail, missingVenues, phoneRows } from './liq-profile-geometry';
import { coinOf, outsideView, windowText } from './liq-profile-text';
import { LiqProfileStore } from './liq-profile.store';

/**
 * IB-153 — under the instrument chart, where the «50 largest» table was: what the liquidation profile is
 * (title, legend, the window, one help line), which venues it could not see, and the link to the raw rows.
 * On a phone it also IS the profile: a horizontal histogram, high price on top, a tap opening a band's
 * venue split. On a desktop the bars are on the price pane itself (`liq-profile.primitive.ts`).
 */
@Component({
  selector: 'app-liq-profile-panel',
  standalone: true,
  imports: [RouterLink, LoaderComponent, LiqProfileDetailComponent],
  templateUrl: './liq-profile-panel.component.html',
  styleUrl: './liq-profile-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiqProfilePanelComponent {
  readonly symbol = input.required<string>();

  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);
  readonly store = inject(LiqProfileStore);
  readonly usd = formatUsd;
  readonly price = formatAmount;

  /** The answer, only while it is this coin's: a symbol switch never shows the last coin's bars. */
  readonly answer = computed(() => { const a = this.store.answer(); return a && a.symbol === this.symbol() ? a : null; });
  readonly window = computed(() => { const a = this.answer(); return a ? windowText(a) : null; });
  readonly missing = computed(() => { const a = this.answer(); return a ? missingVenues(a).map(venueName).join(', ') : ''; });
  readonly outside = computed(() => {
    const a = this.answer();
    const v = this.store.view();
    return a && v ? outsideView(a, v.lo, v.hi) : null;
  });
  readonly rows = computed(() => {
    const a = this.answer();
    const v = this.store.view();
    return a && v ? phoneRows(a, v.lo, v.hi, this.store.lastPrice()) : [];
  });
  readonly coin = computed(() => coinOf(this.symbol()));
  readonly listParams = computed(() => ({ coin: this.symbol(), view: 'list' }));

  /** The band tapped on the phone; tapping it again closes it. */
  readonly selected = signal<number | null>(null);
  readonly detail = computed(() => {
    const a = this.answer();
    const band = this.selected();
    return a && band !== null ? bandDetail(a, band) : null;
  });

  select(band: number): void {
    this.selected.update((current) => (current === band ? null : band));
  }
}

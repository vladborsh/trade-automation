import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { WebLiqProfileResponse } from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import type { BandDetail } from './liq-profile-geometry';
import { detailText } from './liq-profile-text';

/**
 * IB-153 — one price band of the liquidation profile: its range, longs and shorts, the count, and the split
 * by venue (where the old table's venue column lives now). Shown by the desktop tooltip and the phone's tap.
 */
@Component({
  selector: 'app-liq-profile-detail',
  standalone: true,
  templateUrl: './liq-profile-detail.component.html',
  styleUrl: './liq-profile-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiqProfileDetailComponent {
  readonly answer = input.required<WebLiqProfileResponse>();
  readonly detail = input.required<BandDetail>();

  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);
  readonly text = computed(() => detailText(this.answer(), this.detail()));
}

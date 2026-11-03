import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import type { WebPositioningRow } from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import { hostWidth } from '../../ui/host-width';
import { formatUsd } from '../liquidations/liquidations.format';
import { signedPct } from '../market/shell/market-text';
import { quadrantLayout, QUADRANT_PAD } from './pos-layout';

/**
 * IB-090 (D9) — price × OI: one dot per coin, area ∝ OI in USD, the four quadrants named in their
 * corners. A tap on a dot states its numbers under the chart (D16); labels that would overlap
 * are dropped by the layout, never drawn on top of each other.
 */
@Component({
  selector: 'app-pos-quadrant',
  standalone: true,
  templateUrl: './pos-quadrant.component.html',
  styleUrl: './pos-quadrant.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PosQuadrantComponent {
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly rows = input.required<readonly WebPositioningRow[]>();
  readonly width = hostWidth(342);
  /** IB-103: the Market block caps it at 360 px; the positioning page lets it grow. */
  readonly maxHeight = input(360);
  /** D16: the quadrant keeps its aspect ratio on a phone (4:3, capped). */
  readonly height = computed(() => Math.round(Math.min(this.maxHeight(), this.width() * 0.75)));
  readonly layout = computed(() => quadrantLayout(this.rows(), { width: this.width(), height: this.height() }));
  readonly pad = QUADRANT_PAD;
  readonly selected = signal<string | null>(null);
  readonly detail = computed(() => {
    const row = this.rows().find((r) => r.symbol === this.selected());
    if (!row) return null;
    return this.t('positioning.quadrant.detail', {
      coin: row.base,
      price: signedPct(row.priceChangePct.value) ?? '—',
      oi: signedPct(row.oiChangePct.value) ?? '—',
      oiUsd: row.oiUsd === null ? '—' : formatUsd(row.oiUsd),
    });
  });

  pick(symbol: string): void {
    this.selected.set(this.selected() === symbol ? null : symbol);
  }

  axis(v: number, signed = true): string {
    return `${signed && v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} %`;
  }
}

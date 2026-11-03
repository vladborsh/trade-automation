import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { WebCapsDominance } from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import { capUsd } from '../market/market.format';
import { signedPct } from '../market/shell/market-text';
import { dominanceSegments } from './caps-layout';

/** IB-090 (D11) — one bar, BTC / ETH / stablecoins / the rest, summing to 100 (the server's rule). */
@Component({
  selector: 'app-dominance-bar',
  standalone: true,
  templateUrl: './dominance-bar.component.html',
  styleUrl: './dominance-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DominanceBarComponent {
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly dominance = input.required<WebCapsDominance>();
  readonly segments = computed(() => dominanceSegments(this.dominance()));

  pct(v: number): string {
    return `${v.toFixed(1)} %`;
  }

  total(): string {
    const d = this.dominance();
    return this.t('caps.dominance.total', { usd: capUsd(d.totalCapUsd) ?? '', change: signedPct(d.totalCapChangePct24h) ?? this.t('caps.noChange') });
  }
}

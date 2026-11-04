import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import type { WebCapsResponse, WebCapsUnavailable, WebInsightBlockLine, WebMarketPeriod } from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import type { StringKey } from '../../i18n/keys';
import { CardComponent } from '../../ui/card.component';
import { BlockConclusionComponent } from '../market/shell/block-conclusion.component';
import { capsScale } from './caps-layout';
import { CapsTreemapComponent } from './caps-treemap.component';
import { DominanceBarComponent } from './dominance-bar.component';

/**
 * IB-090 — the caps block (D11, D15): treemap, dominance bar, the CoinGecko attribution beside them
 * (its free tier requires it; the terms question is the owner's, design §5), every refusal in words
 * — e.g. 4h, which CoinGecko does not publish — and the block's conclusion line.
 * IB-108 (§7.6): one full-width card — the treemap, then the dominance bar under it, the treemap's
 * legend as the card's subtitle, the credit and the «Вывод:» last.
 */
@Component({
  selector: 'app-caps-block',
  standalone: true,
  imports: [CardComponent, CapsTreemapComponent, DominanceBarComponent, BlockConclusionComponent],
  templateUrl: './caps-block.component.html',
  styleUrl: './caps-block.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CapsBlockComponent {
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly caps = input.required<WebCapsResponse>();
  readonly period = input<WebMarketPeriod>('24h');
  readonly line = input<WebInsightBlockLine | null | undefined>(null);

  /** The treemap's legend, with the colour scale's end (the same `capsScale` the treemap colours by). */
  subtitle(): string {
    return this.t('caps.treemap.legend', { period: this.t(`market.period.${this.caps().period}` as StringKey), scale: capsScale(this.caps().coins) });
  }

  refusal(reason: WebCapsUnavailable): string {
    return this.t(`caps.refused.${reason}` as StringKey, { period: this.t(`market.period.${this.caps().period}` as StringKey) });
  }
}

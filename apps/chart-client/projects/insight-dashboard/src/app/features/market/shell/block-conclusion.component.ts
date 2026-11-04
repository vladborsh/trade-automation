import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { WebInsightBlockLine, WebMarketPeriod } from '@trade-automation/contracts';
import { I18nService } from '../../../i18n/i18n.service';
import type { StringKey } from '../../../i18n/keys';
import { conclusionView, wordInsight, sourceNames } from './market-text';

/**
 * IB-089 (D15) — the one conclusion line a block ends with: the server’s best statement for that
 * block, or the neutral line with its reason and basis. Same words as «Главное сейчас», one engine.
 * IB-108 (D26): it sits in the card's «Вывод» slot — a bold «Вывод:» prefix, the basis in its tooltip.
 */
@Component({
  selector: 'app-block-conclusion',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './block-conclusion.component.html',
  styleUrl: './block-conclusion.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BlockConclusionComponent {
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly line = input<WebInsightBlockLine | null | undefined>(null);
  readonly period = input<WebMarketPeriod>('24h');

  readonly view = computed(() => conclusionView(this.line(), Math.floor(Date.now() / 1000)));

  sentence(): string {
    const v = this.view();
    if (!v) return '';
    if (v.kind === 'statement') return wordInsight(v.view, this.t);
    return this.t(v.key, { period: this.t(`market.period.${this.period()}` as StringKey), sources: sourceNames(v.sources, this.t) });
  }

  basis(): string | null {
    const v = this.view();
    if (!v) return null;
    const b = v.kind === 'statement' ? v.view.basis : v.basis;
    return b === null ? null : wordInsight(b, this.t);
  }
}

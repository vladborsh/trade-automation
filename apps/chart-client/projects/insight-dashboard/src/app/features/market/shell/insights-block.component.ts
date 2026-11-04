import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { WebInsightsResponse, WebMarketPeriod } from '@trade-automation/contracts';
import { I18nService } from '../../../i18n/i18n.service';
import type { StringKey } from '../../../i18n/keys';
import { chipOf } from './insight-card';
import { InsightCardComponent } from './insight-card.component';
import { basisView, neutralLine, sourceNames, wordInsight, type BasisView } from './market-text';

/**
 * IB-088 (D1–D4), IB-107 (§7.3) — «Главное сейчас»: up to 5 cards in a grid, each worded HERE from the
 * server's key and typed params (`InsightCardComponent`). Nothing passed → ONE card with the chip of
 * the block that would have spoken, the neutral sentence for the period, and its basis in the tooltip.
 */
@Component({
  selector: 'app-insights-block',
  standalone: true,
  imports: [InsightCardComponent],
  templateUrl: './insights-block.component.html',
  styleUrl: './insights-block.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InsightsBlockComponent {
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);
  readonly insights = input<WebInsightsResponse | null>(null);
  readonly period = input<WebMarketPeriod>('24h');
  /** IB-BUG-022: the day the page's period becomes available, null when it is (D14). */
  readonly unavailableFrom = input<string | null>(null);

  private readonly nowSec = () => Math.floor(Date.now() / 1000);
  readonly cards = computed(() => (this.insights()?.top ?? []).map((s, i) => ({ id: `${s.ruleId}-${i}`, statement: s, nowSec: this.nowSec() })));
  /** The neutral line: the first block line's basis, so "nothing unusual" still says on what. */
  readonly neutral = computed(() => {
    const lines = this.insights()?.blocks ?? [];
    const withBasis = lines.find((l) => l.neutral?.basis);
    const history = lines.length > 0 && lines.filter((l) => l.neutral).every((l) => l.neutral?.reason !== 'nothing_unusual');
    // IB-BUG-028: every block that has rules could not look → name what did not answer
    const ruled = lines.filter((l) => l.neutral && l.neutral.reason !== 'no_rules');
    const allDown = ruled.length > 0 && ruled.every((l) => l.neutral?.reason === 'source_unavailable');
    const down = allDown ? [...new Set(ruled.flatMap((l) => l.neutral?.sources ?? []))] : [];
    // IB-107: the neutral card wears the chip of the block that would have spoken
    const chip = chipOf({ block: (withBasis ?? lines[0])?.block ?? 'liquidations', params: {} });
    return { history, down, chip, basis: basisView(withBasis?.neutral?.basis ?? null, this.nowSec()) };
  });

  readonly neutralChoice = computed(() => neutralLine(this.unavailableFrom(), this.neutral().history, this.neutral().down));

  neutralText(): string {
    const c = this.neutralChoice();
    return this.t(c.key, { period: this.periodLabel(), date: c.date ?? '', sources: sourceNames(c.sources, this.t) });
  }

  basisText(b: BasisView): string {
    return wordInsight(b, this.t);
  }

  periodLabel(): string {
    return this.t(`market.period.${this.period()}` as StringKey);
  }
}

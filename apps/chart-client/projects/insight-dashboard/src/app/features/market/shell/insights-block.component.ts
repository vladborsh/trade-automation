import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { WebInsightsResponse, WebMarketPeriod } from '@trade-automation/contracts';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../../i18n/i18n.service';
import type { StringKey } from '../../../i18n/keys';
import { basisView, insightView, neutralLine, wordInsight, type InsightView } from './market-text';

/**
 * IB-088 (D1–D4) — «Главное сейчас»: 3–5 cards, each a sentence worded HERE from the server's key and
 * typed params, its basis, and a link to the chart at the moment (or to the block). Nothing passed →
 * one neutral line for the period, with the basis it stood on.
 */
@Component({
  selector: 'app-insights-block',
  standalone: true,
  imports: [RouterLink],
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
  readonly cards = computed(() => (this.insights()?.top ?? []).map((s, i) => ({ id: `${s.ruleId}-${i}`, view: insightView(s, this.nowSec()) })));
  /** The neutral line: the first block line's basis, so "nothing unusual" still says on what. */
  readonly neutral = computed(() => {
    const lines = this.insights()?.blocks ?? [];
    const withBasis = lines.find((l) => l.neutral?.basis);
    const history = lines.length > 0 && lines.filter((l) => l.neutral).every((l) => l.neutral?.reason !== 'nothing_unusual');
    return { history, basis: basisView(withBasis?.neutral?.basis ?? null, this.nowSec()) };
  });

  readonly neutralChoice = computed(() => neutralLine(this.unavailableFrom(), this.neutral().history));

  neutralText(): string {
    const c = this.neutralChoice();
    return this.t(c.key, { period: this.periodLabel(), date: c.date ?? '' });
  }

  sentence(v: InsightView): string {
    return wordInsight(v, this.t);
  }

  basisText(b: { key: StringKey; params: Record<string, string | number> }): string {
    return this.t(b.key, b.params);
  }

  periodLabel(): string {
    return this.t(`market.period.${this.period()}` as StringKey);
  }
}

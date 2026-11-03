import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { WebInsightsResponse, WebMarketPeriod } from '@trade-automation/contracts';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../../i18n/i18n.service';
import type { StringKey } from '../../../i18n/keys';
import { basisView, insightView, type InsightView } from './market-text';

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

  private readonly nowSec = () => Math.floor(Date.now() / 1000);
  readonly cards = computed(() => (this.insights()?.top ?? []).map((s, i) => ({ id: `${s.ruleId}-${i}`, view: insightView(s, this.nowSec()) })));
  /** The neutral line: the first block line's basis, so "nothing unusual" still says on what. */
  readonly neutral = computed(() => {
    const lines = this.insights()?.blocks ?? [];
    const withBasis = lines.find((l) => l.neutral?.basis);
    const history = lines.length > 0 && lines.filter((l) => l.neutral).every((l) => l.neutral?.reason !== 'nothing_unusual');
    return { history, basis: basisView(withBasis?.neutral?.basis ?? null, this.nowSec()) };
  });

  sentence(v: InsightView): string {
    const params: Record<string, string | number> = { ...v.params };
    for (const [name, key] of Object.entries(v.nested)) params[name] = this.t(key);
    return this.t(v.key, params);
  }

  basisText(b: { key: StringKey; params: Record<string, string | number> }): string {
    return this.t(b.key, b.params);
  }

  periodLabel(): string {
    return this.t(`market.period.${this.period()}` as StringKey);
  }
}

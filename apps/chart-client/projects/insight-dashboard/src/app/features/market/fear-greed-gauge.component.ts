import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { WebFearGreedCard } from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import { captionAnchor, gaugeGeometry, historyLine } from './fear-greed-gauge';
import { FEAR_GREED_STYLE, fearGreedBand } from './market.adapter';
import { utcDate, utcDaySec } from '../../shared/time-format';

/** The SVG boxes the geometry is laid out in (viewBox units; the SVGs scale to their container). */
const GAUGE = { w: 200, h: 112, cx: 100, cy: 100, r: 84 };
const LINE = { w: 300, h: 44 };

/**
 * IB-102 — the Fear & Greed card's gauge: a semicircle over the contract's five zones with a needle
 * on today's reading, the number and its zone word, the source's own classification verbatim (§11),
 * the attribution beside the number, and under it the 30-day line (only from 7 published days).
 * Geometry is pure (`fear-greed-gauge.ts`); this only draws it.
 */
@Component({
  selector: 'app-fear-greed-gauge',
  standalone: true,
  templateUrl: './fear-greed-gauge.component.html',
  styleUrl: './fear-greed-gauge.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FearGreedGaugeComponent {
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly card = input.required<WebFearGreedCard>();

  readonly box = GAUGE;
  readonly lineBox = LINE;
  readonly band = computed(() => fearGreedBand(this.card().now.value));
  /** The reading's day is a UTC day (a business period), named by its UTC date (IB-152). */
  readonly asOfDay = computed(() => utcDate(utcDaySec(this.card().now.day)));
  readonly gauge = computed(() => gaugeGeometry(this.card().now.value, GAUGE.cx, GAUGE.cy, GAUGE.r, GAUGE.r - 16));
  /** `history` is optional at runtime: a server from before IB-102 sends none, and then there is no line. */
  readonly line = computed(() => historyLine(this.card().history, LINE.w, LINE.h));
  readonly weekCaption = computed(() => {
    const x = this.line()?.weekAgoX ?? null;
    return x === null ? null : captionAnchor(x, LINE.w);
  });
  readonly style = FEAR_GREED_STYLE;
}

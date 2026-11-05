import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { WebInsightChart, WebInsightStatement } from '@trade-automation/contracts';
import { I18nService } from '../../../i18n/i18n.service';
import type { StringKey } from '../../../i18n/keys';
import { chartGeometry, type XLabel } from './insight-chart.geometry';
import { chartTexts } from './insight-chart.texts';

/**
 * IB-119 (market round 2 §3) — the chart beside an insight card's text: the plot in an SVG with
 * non-scaling strokes, every label in HTML so it stays crisp at any card width. The arithmetic is
 * `insight-chart.geometry.ts`, the wording choices `insight-chart.texts.ts`; this class translates.
 */
@Component({
  selector: 'app-insight-chart',
  standalone: true,
  templateUrl: './insight-chart.component.html',
  styleUrl: './insight-chart.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InsightChartComponent {
  private readonly i18n = inject(I18nService);
  readonly chart = input.required<WebInsightChart>();
  readonly statement = input.required<WebInsightStatement>();
  readonly nowSec = input.required<number>();

  private readonly side = computed(() => {
    const s = this.statement().params['side'];
    return s === 'long' || s === 'short' ? s : null;
  });
  readonly g = computed(() => chartGeometry(this.chart(), this.nowSec(), this.side()));
  readonly texts = computed(() => chartTexts(this.statement(), this.chart()));
  /** R11: the A–B strokes in the alert's direction colour (V15). */
  readonly direction = computed(() => (this.statement().params['direction'] === 'bearish' ? 'down' : 'up'));

  readonly caption = computed(() => this.tr(this.texts().caption));
  /** The value(s) at the chart's focus; with two series each is named (in the text face, the number in mono). */
  readonly corner = computed(() => {
    const g = this.g();
    const two = g.corner.values.length > 1;
    const muted = this.texts().muted;
    const values = g.corner.values.map((v) => ({
      key: v.key, text: v.text, muted: v.key === muted, name: two ? this.t(`ichart.short.${v.key}` as StringKey) : null,
    }));
    return { prefix: this.t(`ichart.corner.${g.corner.focus}` as StringKey), values };
  });
  readonly legend = computed(() => this.texts().legend.map((item) => ({ swatch: item.swatch, text: this.tr(item.phrase) })));
  readonly ariaLabel = computed(() => `${this.caption()} — ${this.corner().prefix} ${this.corner().values.map((v) => v.text).join(', ')}`);

  xText(l: XLabel): string {
    if (l.text.kind === 'now') return this.t('ichart.x.now');
    if (l.text.kind === 'at') return l.text.text;
    return this.t(`ichart.x.ago.${l.text.unit}` as StringKey, { n: l.text.n });
  }

  private tr(p: { key: StringKey; params: Record<string, string | number>; nested: Record<string, StringKey> }): string {
    const nested = Object.fromEntries(Object.entries(p.nested).map(([k, key]) => [k, this.t(key)]));
    return this.t(p.key, { ...p.params, ...nested });
  }

  private t(key: StringKey, params?: Record<string, string | number>): string {
    this.i18n.lang(); // read so a language switch re-words the chart
    return this.i18n.t(key, params);
  }
}

import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { WebInsightStatement } from '@trade-automation/contracts';
import { I18nService } from '../../../i18n/i18n.service';
import { cardView, figureRuns, type Phrase } from './insight-card';
import { wordInsight } from './market-text';
import { sparkGeometry } from './spark-bars';

/**
 * IB-107 (market-page design §7.3) — one «Главное сейчас» card: topic chip and «when», the title,
 * what the number means (D20), the mini-chart from the statement's own series, a link that says
 * where it goes, and the quiet basis with the sample sizes in its tooltip. All wording is chosen in
 * `insight-card.ts`; this class only translates and draws.
 */
@Component({
  selector: 'app-insight-card',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './insight-card.component.html',
  styleUrl: './insight-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InsightCardComponent {
  private readonly i18n = inject(I18nService);
  private readonly document = inject(DOCUMENT);
  readonly statement = input.required<WebInsightStatement>();
  readonly nowSec = input.required<number>();

  readonly view = computed(() => cardView(this.statement(), this.nowSec()));
  readonly titleRuns = computed(() => figureRuns(this.word(this.view().title), this.view().figures));
  readonly explanation = computed(() => this.view().explanation.map((p) => this.word(p)).join(' '));
  readonly spark = computed(() => {
    const s = this.view().spark;
    return s === null ? null : sparkGeometry(s, this.view().sparkScale);
  });

  /**
   * IB-BUG-035: the router only updates the fragment (no anchor scrolling is configured, and a
   * second click on the same fragment is not a navigation at all), so the click scrolls itself.
   */
  scrollToBlock(id: string): void {
    this.document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  word(p: Phrase): string {
    // the lang signal is read so a language switch re-words the card
    this.i18n.lang();
    return wordInsight(p, this.i18n.t.bind(this.i18n));
  }
}

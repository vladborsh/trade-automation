import { ChangeDetectionStrategy, Component, inject, input, signal, type OnInit } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { helpStartsOpen } from './help-block-state';

/**
 * IB-120 (market-round2 design §4) — a collapsible help panel: a title line that opens and closes
 * it, and whatever the host projects as its body. Shared: /liquidations' «Как этим пользоваться»
 * (IB-120) and the heat table's «Что значит подсветка» on Market and /positioning (IB-121).
 *
 * The API is the four things the design names, nothing more:
 * - `title` — the summary line, already translated by the host;
 * - the body — content projection, so the host keeps its own i18n keys and CSS classes (IB-121's
 *   swatches must be drawn by the heat table's own classes);
 * - `storageKey` — which visit is remembered (`help-seen:<key>` in localStorage);
 * - `openOnFirstVisit` — open the first time, collapsed later (default); false = always collapsed.
 *
 * A native `<details>`: keyboard and screen readers get a disclosure for free.
 */
@Component({
  selector: 'app-help-block',
  standalone: true,
  templateUrl: './help-block.component.html',
  styleUrl: './help-block.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HelpBlockComponent implements OnInit {
  private readonly doc = inject(DOCUMENT);

  readonly title = input.required<string>();
  readonly storageKey = input.required<string>();
  readonly openOnFirstVisit = input(true);

  readonly open = signal(false);

  ngOnInit(): void {
    this.open.set(helpStartsOpen(() => this.doc.defaultView?.localStorage, this.storageKey(), this.openOnFirstVisit()));
  }

  onToggle(event: Event): void {
    this.open.set((event.target as HTMLDetailsElement).open);
  }
}

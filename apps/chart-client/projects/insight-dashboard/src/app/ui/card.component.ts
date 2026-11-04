import { ChangeDetectionStrategy, Component, input } from '@angular/core';

let nextId = 0;

/**
 * IB-106 (market-page design §7.2, «Card spec») — the box every Market block sits in: the
 * `--card-*` fill, border, radius and padding, and a column of
 *   heading row  — `h2` (`--type-h2`), a muted subtitle (`--type-note`), and a right-hand slot
 *                  (`[cardActions]`: a threshold select, «Показать все») at the end of the row;
 *   content      — the default slot;
 *   «Вывод:»     — the `[cardConclusion]` slot, last (D26: the block's line from `/insights`).
 * The HOST is the box, so a page sizes a card directly (`flex: 999 1 560px` on `app-card`).
 * The card words nothing itself: the heading and subtitle arrive translated.
 */
@Component({
  selector: 'app-card',
  standalone: true,
  templateUrl: './card.component.html',
  styleUrl: './card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'region', '[attr.aria-labelledby]': 'headingId' },
})
export class CardComponent {
  readonly heading = input.required<string>();
  readonly subtitle = input<string | null>(null);
  readonly headingId = `card-h-${++nextId}`;
}

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type LoaderVariant = 'inline' | 'block' | 'overlay' | 'skeleton';

/**
 * The dashboard's one loading indicator (2026-10-24, design-system.md §Loading).
 *
 * - `inline`: a small ring and a word, in a line of text or a header.
 * - `block`: the same, centred in a reserved area, for a panel whose content has not arrived.
 * - `overlay`: over content that is being replaced (the chart while a new timeframe loads), so the
 *   old content stays readable underneath instead of the layout collapsing and jumping back.
 * - `skeleton`: grey bars the shape of a card's text, for cards whose layout is known in advance.
 *
 * Every variant appears only after 150 ms (CSS, no timer), so a fast answer never flashes it, and
 * stops moving under `prefers-reduced-motion`. `role="status"` makes a screen reader say the label.
 */
@Component({
  selector: 'app-loader',
  standalone: true,
  templateUrl: './loader.component.html',
  styleUrl: './loader.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': '"loader " + variant()' },
})
export class LoaderComponent {
  readonly variant = input<LoaderVariant>('inline');
  /** What is loading, in the reader's language. Also the accessible name. */
  readonly label = input<string>('');
  /** Skeleton only: how many text lines to imitate. */
  readonly lines = input<number>(3);

  readonly bars = computed(() => Array.from({ length: Math.max(1, this.lines()) }, (_, i) => i));
}

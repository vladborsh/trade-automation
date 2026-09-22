import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * T-048 (the user's feedback, item 14) — visible controls for what the hotkeys do, so the keys are
 * not the only way to find them: Buy / Sell draw a long / short position tool (B / S), Place opens
 * the order popup for the active draft (Enter). Each tooltip names its hotkey. Presentational: the
 * workspace runs the same code paths as the keys.
 */
@Component({
  selector: 'app-trade-controls',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './trade-controls.component.html',
  styleUrl: './trade-controls.component.scss',
})
export class TradeControlsComponent {
  /** A complete session takes no new orders (decision 28). */
  readonly disabled = input(false);

  readonly draw = output<'long' | 'short'>();
  readonly place = output<void>();

  /** A mouse click hands focus back to the page, so the hotkeys act on the chart at once. */
  protected clicked(event: MouseEvent, then: () => void): void {
    if (event.detail > 0) (event.currentTarget as HTMLElement | null)?.blur();
    then();
  }
}

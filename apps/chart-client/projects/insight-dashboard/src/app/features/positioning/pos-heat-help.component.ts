import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { I18nService } from '../../i18n/i18n.service';
import { HelpBlockComponent } from '../../ui/help-block.component';
import { HEAT_HELP_LEVELS, SIGNAL_HELP } from './pos-heat-help';

/**
 * IB-121 (market-round2 design §5) — «Что значит подсветка и как читать таблицу», above the heat
 * table. One component for both places, through IB-120's `app-help-block`:
 * - Market (`compact`): one collapsed line «Что значит подсветка?», never opened by itself;
 * - /positioning: open on the first visit, collapsed afterwards.
 * The swatches carry `data-heat` and take their fill from `_heat.scss`, the table cells' own rules.
 */
@Component({
  selector: 'app-pos-heat-help',
  standalone: true,
  imports: [HelpBlockComponent],
  templateUrl: './pos-heat-help.component.html',
  styleUrl: './pos-heat-help.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PosHeatHelpComponent {
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly compact = input(false);

  readonly title = computed(() => this.t(this.compact() ? 'positioning.help.titleShort' : 'positioning.help.title'));
  readonly levels = HEAT_HELP_LEVELS;
  readonly signals = SIGNAL_HELP;
}

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { I18nService } from '../../i18n/i18n.service';
import type { StringKey } from '../../i18n/keys';
import { HelpBlockComponent } from '../../ui/help-block.component';

/**
 * IB-138 (market-round3 design §5) — «Как читать эти показатели?» on Market's «Деривативы и потоки»
 * card: for each of the four tiles what it is, how to read it and what it does NOT say (D20: no
 * forecasts). One collapsed line that never opens by itself, as the heat table's help in `compact`
 * mode (IB-121), through IB-120's `app-help-block`. The text is design §5 word for word.
 */
@Component({
  selector: 'app-flows-help',
  standalone: true,
  imports: [HelpBlockComponent],
  templateUrl: './flows-help.component.html',
  styleUrl: './flows-help.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlowsHelpComponent {
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  /** In the tiles' order (`flowsTiles`). */
  readonly rows: readonly { lead: StringKey; text: StringKey }[] = [
    { lead: 'flows.help.dvol.lead', text: 'flows.help.dvol.text' },
    { lead: 'flows.help.putCall.lead', text: 'flows.help.putCall.text' },
    { lead: 'flows.help.stable.lead', text: 'flows.help.stable.text' },
    { lead: 'flows.help.premium.lead', text: 'flows.help.premium.text' },
  ];
}

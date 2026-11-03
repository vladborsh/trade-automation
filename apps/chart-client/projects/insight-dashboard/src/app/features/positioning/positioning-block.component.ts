import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import type { WebInsightBlockLine, WebMarketPeriod, WebPositioningResponse } from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import { BlockConclusionComponent } from '../market/shell/block-conclusion.component';
import { PosHeatComponent } from './pos-heat.component';
import { PosQuadrantComponent } from './pos-quadrant.component';

/** IB-090 — the positioning block (D9, D15): the quadrant, the heat table, its conclusion line. */
@Component({
  selector: 'app-positioning-block',
  standalone: true,
  imports: [PosQuadrantComponent, PosHeatComponent, BlockConclusionComponent],
  templateUrl: './positioning-block.component.html',
  styleUrl: './positioning-block.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PositioningBlockComponent {
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly positioning = input.required<WebPositioningResponse>();
  readonly period = input<WebMarketPeriod>('24h');
  readonly line = input<WebInsightBlockLine | null | undefined>(null);
}

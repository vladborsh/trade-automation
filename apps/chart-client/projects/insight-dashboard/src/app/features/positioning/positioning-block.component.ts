import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { WebInsightBlockLine, WebMarketPeriod, WebPositioningResponse } from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import { BlockConclusionComponent } from '../market/shell/block-conclusion.component';
import { PosHeatComponent } from './pos-heat.component';

/** IB-103: the Market tab's compact table: the five most unusual coins answer «who is unusual now». */
export const MARKET_HEAT_ROWS = 5;

/**
 * IB-090 (D9) / IB-103 — positioning on the Market tab, COMPACT: the five most unusual rows of the
 * heat table, the block's one conclusion (D15) and a link to the full page (/positioning, same
 * period). The quadrant moved to that page: on a phone it took the screen and, without its labels,
 * did not read. Same `app-pos-heat` component as the page, with a row limit: no second copy.
 */
@Component({
  selector: 'app-positioning-block',
  standalone: true,
  imports: [PosHeatComponent, BlockConclusionComponent, RouterLink],
  templateUrl: './positioning-block.component.html',
  styleUrl: './positioning-block.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PositioningBlockComponent {
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly positioning = input.required<WebPositioningResponse>();
  readonly period = input.required<WebMarketPeriod>();
  readonly line = input<WebInsightBlockLine | null>(null);
  readonly rows = MARKET_HEAT_ROWS;
}

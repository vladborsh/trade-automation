import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import type { WebLiquidationFeedEvent } from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import { hostWidth } from '../../ui/host-width';
import { bubbleLayout, instrumentLink, LOCAL_OFFSET, tickLabel } from './liq-layout';
import { formatUsd } from './liquidations.format';

/**
 * IB-089 (D8c) — the bubble timeline: radius ∝ √USD, shorts above the axis, longs below. A bubble
 * opens the instrument at that minute, `/instrument/<sym>?at=<sec>` (IB-088's link format).
 * IB-120: moved out of `app-liq-large` unchanged, so Market and /liquidations draw ONE chart.
 */
@Component({
  selector: 'app-liq-bubbles',
  standalone: true,
  templateUrl: './liq-bubbles.component.html',
  styleUrl: './liq-bubbles.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiqBubblesComponent {
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly events = input.required<readonly WebLiquidationFeedEvent[]>();
  /** The period on the time axis, unix seconds. */
  readonly from = input.required<number>();
  readonly to = input.required<number>();
  readonly bucketSec = input(3_600);

  readonly height = 140;
  readonly width = hostWidth(342);
  /** 4-hour buckets mean the 7d period, whose axis labels days only (IB-BUG-036). */
  readonly layout = computed(() => bubbleLayout(
    this.events(),
    { from: this.from(), to: this.to() },
    { width: this.width(), height: this.height },
    { days: this.bucketSec() > 3_600, offset: LOCAL_OFFSET },
  ));
  readonly usd = formatUsd;

  time(event: WebLiquidationFeedEvent): string {
    return tickLabel(event.time, 60);
  }

  side(event: WebLiquidationFeedEvent): string {
    return this.t(event.side === 'long' ? 'liq.side.longs' : 'liq.side.shorts');
  }

  open(event: WebLiquidationFeedEvent): void {
    const link = instrumentLink(event);
    void this.router.navigate(link.commands, { queryParams: link.queryParams });
  }
}

import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import type { WebCapsCoin, WebMarketPeriod } from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import type { StringKey } from '../../i18n/keys';
import { hostWidth } from '../../ui/host-width';
import { capUsd } from '../market/market.format';
import { signedPct } from '../market/shell/market-text';
import { bigTile, capsScale, changeColour, squarify, tileText } from './caps-layout';

/**
 * IB-090 (D11) — the top coins as a squarified treemap: area = market cap, colour = the period's
 * change on a scale symmetric around 0. A tap states a tile's numbers (D16); when the source has
 * no change for the period the tiles stay neutral and the block says why.
 * IB-108 (§7.6): full width under the card's heading (which carries the legend); the two largest
 * tiles get the big label with «$cap · change» at their foot; «нажмите на плитку» is the tooltip.
 */
@Component({
  selector: 'app-caps-treemap',
  standalone: true,
  templateUrl: './caps-treemap.component.html',
  styleUrl: './caps-treemap.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CapsTreemapComponent {
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly coins = input.required<readonly WebCapsCoin[]>();
  readonly period = input<WebMarketPeriod>('24h');
  readonly width = hostWidth(342);
  /** D16: the treemap keeps its aspect ratio on a phone. */
  readonly height = computed(() => Math.round(Math.min(320, this.width() * 0.7)));
  readonly scale = computed(() => capsScale(this.coins()));
  readonly tiles = computed(() => squarify(this.coins(), (c) => c.capUsd, { x: 0, y: 0, w: this.width(), h: this.height() })
    .map((tile, i) => ({ ...tile, fill: changeColour(tile.item.changePct, this.scale()), text: tileText(tile, { symbol: tile.item.symbol, change: signedPct(tile.item.changePct) ?? '' }), big: bigTile(i, tile) })));
  readonly selected = signal<string | null>(null);
  readonly detail = computed(() => {
    const c = this.coins().find((x) => x.id === this.selected());
    return c ? this.describe(c) : null;
  });

  pick(id: string): void {
    this.selected.set(this.selected() === id ? null : id);
  }

  capLine(c: WebCapsCoin): string {
    return this.t('caps.tileFoot', { cap: capUsd(c.capUsd) ?? '', change: signedPct(c.changePct, 1) ?? this.t('caps.noChange') });
  }

  change(c: WebCapsCoin): string {
    return signedPct(c.changePct) ?? '';
  }

  describe(c: WebCapsCoin): string {
    return this.t('caps.tile', { name: c.name, symbol: c.symbol, cap: capUsd(c.capUsd) ?? '', change: signedPct(c.changePct) ?? this.t('caps.noChange') });
  }

  legend(): string {
    return this.t('caps.treemap.legend', { period: this.t(`market.period.${this.period()}` as StringKey), scale: this.scale() });
  }
}

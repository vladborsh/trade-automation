import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { WebFearGreedResponse, WebMarketCapResponse } from '@trade-automation/contracts';
import { InsightApiClient } from '../../core/insight-api.client';
import { I18nService } from '../../i18n/i18n.service';
import { btcShareLine, dominanceLine, fearGreedBand, fearGreedLine, gaugePoint, shareLegend, stackedBands, coinPrice } from './market.adapter';

/** The ranges the picker offers, in days. 365 is the ceiling the per-coin source imposes (§10). */
export const MARKET_RANGES = [30, 90, 180, 365] as const;
export type MarketRange = (typeof MARKET_RANGES)[number];

const DAY_MS = 86_400_000;

/**
 * architecture/insight-bot-web-dashboard.md §2, §10 — the market-context page: Fear & Greed with
 * its history, BTC dominance of the whole market (forward-collected), the top-20 stacked shares
 * with BTC's share of Σ top-20, and the current caps.
 *
 * Every figure is the server's; the geometry is `market.adapter.ts`, pure and spec'd. The two
 * BTC ratios are drawn apart on purpose — `/global` dominance is BTC over the whole market,
 * `btcShare` is BTC over the top 20 — because averaging or overlaying them would invent a third
 * number that is neither.
 */
@Component({
  selector: 'app-market',
  standalone: true,
  templateUrl: './market.component.html',
  styleUrl: './market.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarketComponent {
  private readonly api = inject(InsightApiClient);
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  readonly ranges = MARKET_RANGES;
  readonly range = signal<MarketRange>(365);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly fearGreed = signal<WebFearGreedResponse | null>(null);
  readonly marketCap = signal<WebMarketCapResponse | null>(null);

  /** Today's value: the whole series' newest point, never the window's (the server sends both). */
  readonly latest = computed(() => this.fearGreed()?.latest ?? null);
  readonly band = computed(() => fearGreedBand(this.latest()?.value ?? 0));
  readonly needle = computed(() => gaugePoint(this.latest()?.value ?? 0));
  readonly fgLine = computed(() => fearGreedLine(this.fearGreed()?.points ?? []));
  readonly bands = computed(() => stackedBands(this.marketCap()?.days ?? []));
  readonly btcLine = computed(() => btcShareLine(this.marketCap()?.days ?? []));
  readonly domLine = computed(() => dominanceLine(this.marketCap()?.dominance ?? []));
  readonly legend = computed(() => shareLegend(this.marketCap()?.days ?? []));
  readonly current = computed(() => this.marketCap()?.current ?? []);

  /** The dominance line's honest start: §10's series cannot be backfilled, so it has a real age. */
  readonly dominanceStart = computed(() => {
    const start = this.marketCap()?.dominanceStart;
    return start === null || start === undefined ? null : new Date(start).toISOString().slice(0, 10);
  });

  /** How many of the top 20 the newest day actually counted — the denominator's honesty (§10). */
  readonly coinsCounted = computed(() => this.marketCap()?.days.at(-1)?.coinsCounted ?? 0);

  readonly downsampled = computed(() => Boolean(this.fearGreed()?.downsampled || this.marketCap()?.downsampled));

  constructor() {
    void this.load();
  }

  setRange(days: MarketRange): void {
    if (days === this.range()) return;
    this.range.set(days);
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    const to = Date.now();
    const from = to - this.range() * DAY_MS;
    try {
      const [fg, caps] = await Promise.all([this.api.fearGreed(from, to), this.api.marketCap(from, to)]);
      this.fearGreed.set(fg);
      this.marketCap.set(caps);
    } catch (err) {
      this.error.set((err as Error).message);
    } finally {
      this.loading.set(false);
    }
  }

  /** A fraction as a signed percentage for the table; null stays a dash in the template. */
  percent(value: number | null): string | null {
    return value === null ? null : `${value >= 0 ? '+' : '−'}${Math.abs(value * 100).toFixed(2)}`;
  }

  /** A price with the digits its magnitude deserves — see `coinPrice`. */
  price(value: number | null): string | null {
    return coinPrice(value);
  }

  /** A cap in billions, the unit the whole table is read in. */
  billions(value: number | null): string | null {
    return value === null ? null : (value / 1e9).toFixed(2);
  }

  share(value: number | null): string | null {
    return value === null ? null : (value * 100).toFixed(2);
  }
}

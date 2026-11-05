import { signal } from '@angular/core';
import type { WebOiDivergenceLine } from '@trade-automation/contracts';
import type { InsightApiClient } from '../../core/insight-api.client';
import type { DivergencePrefs } from './divergence-prefs';
import { divergenceTf } from './oi-divergence-lines';
import type { PaneData } from './pane-data';

/**
 * IB-110 — the instrument page's OI divergence lines: fetched beside the window (never blocking it),
 * merged into the chart's data, and left out — as an EMPTY list, so the legend keeps its entry — when
 * the reader hid them. IB-144 (V44): per kind — the regular and the hidden lines each have their own switch.
 * Kept out of `instrument.component.ts`, which sits at the 250-line ceiling.
 *
 * A switch only changes the lines, so its merge is marked `extendsLater`: the chart redraws on the
 * same time scale and the reader's zoom and scroll survive (`carried-view.ts`).
 */
export class DivergenceOverlay {
  readonly lines = signal<{ key: string; lines: readonly WebOiDivergenceLine[] } | null>(null);
  private generation = 0;
  private lastPanes: PaneData | null = null;
  private lastSwitches: string | null = null;

  constructor(private readonly api: InsightApiClient, private readonly prefs: DivergencePrefs) {}

  /** For a symbol and chart frame; other frames, or a failed read, have none (and say nothing). */
  async load(symbol: string, timeframe: string): Promise<void> {
    const generation = ++this.generation;
    this.lines.set(null);
    const tf = divergenceTf(timeframe);
    if (!tf) return;
    try {
      const res = await this.api.oiDivergences(symbol, tf);
      if (generation === this.generation) this.lines.set({ key: `${symbol}:${timeframe}`, lines: res.lines });
    } catch {
      // the chart is whole without them; nothing to say in place of a mark
    }
  }

  /** The chart's data with the lines in, for the window on screen (same symbol and frame only). */
  merge(panes: PaneData | null): PaneData | null {
    if (!panes) return null;
    const got = this.lines();
    const off = { regular: this.prefs.hidden(), hidden: this.prefs.hiddenKindHidden() };
    const switches = `${off.regular}:${off.hidden}`;
    // `instrument` is the venue-qualified id (`binance:BTCUSDT`); the lines were asked for the bare symbol
    const symbol = panes.instrument.split(':').pop();
    const lines = got && got.key === `${symbol}:${panes.timeframe}` ? got.lines : undefined;
    // the same window, only the lines or the switch moved: redraw in place, keeping the reader's view
    const inPlace = panes === this.lastPanes && (this.lastSwitches !== switches || lines !== undefined);
    this.lastPanes = panes;
    this.lastSwitches = switches;
    const divergences = lines?.filter((l) => !off[l.kind]);
    return { ...panes, divergences, ...(inPlace ? { extendsLater: true } : {}) };
  }
}

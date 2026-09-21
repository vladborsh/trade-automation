import { LineSeries, LineStyle, type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import type { IndicatorPoint, IndicatorSeriesSpec, Timeframe } from '@trade-automation/contracts';

function msToTime(ms: number): UTCTimestamp {
  return Math.floor(ms / 1000) as UTCTimestamp;
}

function seriesKey(strategyId: string, seriesId: string, key: string): string {
  return `${strategyId}:${seriesId}:${key}`;
}

function groupKey(strategyId: string, seriesId: string): string {
  return `${strategyId}:${seriesId}`;
}

/**
 * Owns one lightweight-charts `LineSeries` per `(strategyId, seriesId, key)`
 * (architecture/vwap-band-reversal-plugin.md §3.2), separate from
 * `OverlayLayer`. Series title carries the spec's label (which for a
 * research-tier strategy already says "research, unvalidated" — §6).
 *
 * Timeframe rule (§3.1): an indicator series is drawn only when the point's
 * own timeframe equals the chart's currently displayed timeframe — on a
 * mismatch it is hidden, never resampled/downsampled, since
 * lightweight-charts merges time scales across series and misaligned points
 * would insert phantom time slots on the candlestick scale.
 *
 * T-028 (provisional contract, pending Architect): a spec with `scale: 'pane'` (RSI, MACD,
 * Stochastic on backtest panels) is drawn in its **own pane** below the price pane, one pane per
 * indicator instance, with its `levels` as dashed price lines and `range` as a fixed scale. A pane
 * group that is no longer rendered is removed together with its (then empty) pane. Price-scale
 * specs — everything the live terminal's strategies emit — take the unchanged path above.
 */
export class IndicatorLayer {
  private chart: IChartApi | null = null;
  private readonly series = new Map<string, ISeriesApi<'Line'>>();
  /** 'pane' groups by `${strategyId}:${seriesId}`: their series (by key) and level lines. */
  private readonly paneGroups = new Map<string, { series: Map<string, ISeriesApi<'Line'>>; lines: IPriceLine[] }>();

  attach(chart: IChartApi): void {
    this.chart = chart;
  }

  private ensureSeries(strategyId: string, seriesId: string, seriesLabel: string, key: IndicatorSeriesSpec['keys'][number]): ISeriesApi<'Line'> {
    const id = seriesKey(strategyId, seriesId, key.key);
    const existing = this.series.get(id);
    if (existing) {
      return existing;
    }
    if (!this.chart) {
      throw new Error('IndicatorLayer.attach(chart) must be called before rendering');
    }
    const created = this.chart.addSeries(LineSeries, {
      color: key.color ?? '#d29922',
      lineWidth: 1,
      lineStyle: key.style === 'dashed' ? 2 : 0,
      title: `${seriesLabel} · ${key.label}`,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    this.series.set(id, created);
    return created;
  }

  /**
   * `points`: every known point for the active instrument, any strategy,
   * any timeframe. `specs`: `IndicatorSeriesSpec` keyed by `${strategyId}:${seriesId}`.
   * `chartTimeframe`: the terminal's currently selected timeframe.
   */
  render(
    points: readonly IndicatorPoint[],
    specs: ReadonlyMap<string, IndicatorSeriesSpec>,
    chartTimeframe: Timeframe,
  ): void {
    if (!this.chart) {
      return;
    }

    const byGroup = new Map<string, IndicatorPoint[]>();
    for (const point of points) {
      const gid = groupKey(point.strategyId, point.seriesId);
      const bucket = byGroup.get(gid) ?? [];
      bucket.push(point);
      byGroup.set(gid, bucket);
    }

    const active = new Set<string>();
    const activePanes = new Set<string>();

    for (const [gid, groupPoints] of byGroup) {
      const spec = specs.get(gid);
      if (!spec) {
        continue;
      }
      const [strategyId, seriesId] = gid.split(':') as [string, string];
      const visible = groupPoints.every((p) => p.timeframe === chartTimeframe) && groupPoints.length > 0;
      const sorted = groupPoints.slice().sort((a, b) => a.time - b.time);

      if (spec.scale === 'pane') {
        if (visible) {
          this.renderPaneGroup(gid, spec, sorted);
          activePanes.add(gid);
        }
        continue;
      }

      for (const keySpec of spec.keys) {
        const lineSeries = this.ensureSeries(strategyId, seriesId, spec.label, keySpec);
        active.add(seriesKey(strategyId, seriesId, keySpec.key));
        if (!visible) {
          lineSeries.applyOptions({ visible: false });
          continue;
        }
        const data = sorted
          .filter((p) => typeof p.values[keySpec.key] === 'number')
          .map((p) => ({ time: msToTime(p.time), value: p.values[keySpec.key] as number }));
        lineSeries.setData(data);
        lineSeries.applyOptions({ visible: true });
      }
    }

    for (const [id, lineSeries] of this.series) {
      if (!active.has(id)) {
        lineSeries.applyOptions({ visible: false });
      }
    }

    for (const gid of [...this.paneGroups.keys()]) {
      if (!activePanes.has(gid)) {
        this.removePaneGroup(gid);
      }
    }
  }

  /** A 'pane' group: its own pane (created on first render), one line per key, levels and range. */
  private renderPaneGroup(gid: string, spec: IndicatorSeriesSpec, sorted: readonly IndicatorPoint[]): void {
    const chart = this.chart!;
    let group = this.paneGroups.get(gid);
    if (!group) {
      group = { series: new Map(), lines: [] };
      this.paneGroups.set(gid, group);
      const paneIndex = chart.panes().length; // a new pane below the existing ones
      const range = spec.range;
      for (const keySpec of spec.keys) {
        const lineSeries = chart.addSeries(
          LineSeries,
          {
            color: keySpec.color ?? '#d29922',
            lineWidth: 1,
            lineStyle: keySpec.style === 'dashed' ? LineStyle.Dashed : LineStyle.Solid,
            title: `${spec.label} · ${keySpec.label}`,
            lastValueVisible: false,
            priceLineVisible: false,
            ...(range ? { autoscaleInfoProvider: () => ({ priceRange: { minValue: range.min, maxValue: range.max } }) } : {}),
          },
          paneIndex,
        );
        group.series.set(keySpec.key, lineSeries);
      }
      const first = group.series.values().next().value;
      for (const level of spec.levels ?? []) {
        const line = first?.createPriceLine({ price: level, color: '#8b949e', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
        if (line) group.lines.push(line);
      }
    }
    for (const [key, lineSeries] of group.series) {
      lineSeries.setData(
        sorted.filter((p) => typeof p.values[key] === 'number').map((p) => ({ time: msToTime(p.time), value: p.values[key] as number })),
      );
    }
  }

  /** Removes a 'pane' group's series, then its pane if lightweight-charts left it behind empty. */
  private removePaneGroup(gid: string): void {
    const group = this.paneGroups.get(gid);
    this.paneGroups.delete(gid);
    if (!group || !this.chart) return;
    const first = group.series.values().next().value;
    const paneIndex = first ? first.getPane().paneIndex() : -1;
    const panesBefore = this.chart.panes().length;
    for (const lineSeries of group.series.values()) this.chart.removeSeries(lineSeries);
    const panes = this.chart.panes();
    if (paneIndex > 0 && panes.length === panesBefore && panes[paneIndex]?.getSeries().length === 0) {
      this.chart.removePane(paneIndex);
    }
  }

  /** Number of indicator line series currently shown (§3.1's timeframe rule) — an e2e test hook. */
  visibleSeriesCount(): number {
    let count = 0;
    for (const lineSeries of this.series.values()) {
      if (lineSeries.options().visible === true) {
        count += 1;
      }
    }
    for (const group of this.paneGroups.values()) {
      count += group.series.size;
    }
    return count;
  }

  /** Removes every series this layer owns — call on instrument switch. */
  clearAll(): void {
    if (this.chart) {
      for (const lineSeries of this.series.values()) {
        this.chart.removeSeries(lineSeries);
      }
    }
    this.series.clear();
    for (const gid of [...this.paneGroups.keys()]) this.removePaneGroup(gid);
  }

  /** Panes this layer currently owns (e2e and specs). */
  paneCount(): number {
    return this.paneGroups.size;
  }
}

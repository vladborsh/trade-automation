import { LineSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
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
 */
export class IndicatorLayer {
  private chart: IChartApi | null = null;
  private readonly series = new Map<string, ISeriesApi<'Line'>>();

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

    for (const [gid, groupPoints] of byGroup) {
      const spec = specs.get(gid);
      if (!spec) {
        continue;
      }
      const [strategyId, seriesId] = gid.split(':') as [string, string];
      const visible = groupPoints.every((p) => p.timeframe === chartTimeframe) && groupPoints.length > 0;
      const sorted = groupPoints.slice().sort((a, b) => a.time - b.time);

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
  }

  /** Number of indicator line series currently shown (§3.1's timeframe rule) — an e2e test hook. */
  visibleSeriesCount(): number {
    let count = 0;
    for (const lineSeries of this.series.values()) {
      if (lineSeries.options().visible === true) {
        count += 1;
      }
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
  }
}

import { HistogramSeries, LineSeries, LineStyle, type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import type { IndicatorPoint, IndicatorSeriesSpec, Timeframe } from '@trade-automation/contracts';

type KeySpec = IndicatorSeriesSpec['keys'][number];
/** A key's series: a line, or (T-057) a histogram. */
type KeySeries = ISeriesApi<'Line'> | ISeriesApi<'Histogram'>;

/** T-057: histogram bars coloured by sign, from the AGENTS.md up/down palette. */
const HISTOGRAM_UP = '#26a69a';
const HISTOGRAM_DOWN = '#ef5350';

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
 *
 * T-047: `labels` off (the replay workspace) draws lines only — no series title text on the chart.
 * The live terminal keeps them: its research strategies' titles carry the "research, unvalidated"
 * wording (§6), and they come through this same layer.
 *
 * T-057: a key with `plot: 'histogram'` (MACD's `hist`) is a `HistogramSeries` in the same pane
 * instead of a line, each bar coloured by its sign (up ≥ 0, down < 0). Every other key — all the
 * terminal's strategy series — is a line, as before.
 */
export class IndicatorLayer {
  constructor(private readonly labels: () => boolean = () => true) {}

  private chart: IChartApi | null = null;
  private readonly series = new Map<string, KeySeries>();
  /** 'pane' groups by `${strategyId}:${seriesId}`: their series (by key) and level lines. */
  private readonly paneGroups = new Map<string, { series: Map<string, KeySeries>; lines: IPriceLine[] }>();

  attach(chart: IChartApi): void {
    this.chart = chart;
  }

  private ensureSeries(strategyId: string, seriesId: string, seriesLabel: string, key: KeySpec): KeySeries {
    const id = seriesKey(strategyId, seriesId, key.key);
    const existing = this.series.get(id);
    if (existing) {
      return existing;
    }
    if (!this.chart) {
      throw new Error('IndicatorLayer.attach(chart) must be called before rendering');
    }
    const created = this.addKeySeries(key, this.title(seriesLabel, key.label));
    this.series.set(id, created);
    return created;
  }

  /** One key's series: a line (the default) or, for `plot: 'histogram'`, a histogram (T-057). */
  private addKeySeries(key: KeySpec, title: string, paneIndex?: number, extra: object = {}): KeySeries {
    const chart = this.chart!;
    const common = { title, lastValueVisible: false, priceLineVisible: false, ...extra };
    // the price pane is the default: no pane argument at all there, exactly as before T-057
    const pane = paneIndex === undefined ? [] : [paneIndex];
    if (key.plot === 'histogram') return chart.addSeries(HistogramSeries, common, ...pane);
    const line = { color: key.color ?? '#d29922', lineWidth: 1 as const, lineStyle: key.style === 'dashed' ? LineStyle.Dashed : LineStyle.Solid, ...common };
    return chart.addSeries(LineSeries, line, ...pane);
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
        setKeyData(lineSeries, keySpec, sorted);
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
        const extra = range ? { autoscaleInfoProvider: () => ({ priceRange: { minValue: range.min, maxValue: range.max } }) } : {};
        group.series.set(keySpec.key, this.addKeySeries(keySpec, this.title(spec.label, keySpec.label), paneIndex, extra));
      }
      const first = group.series.values().next().value;
      for (const level of spec.levels ?? []) {
        const line = first?.createPriceLine({ price: level, color: '#8b949e', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
        if (line) group.lines.push(line);
      }
    }
    for (const keySpec of spec.keys) {
      const keySeries = group.series.get(keySpec.key);
      if (keySeries) setKeyData(keySeries, keySpec, sorted);
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

  /** A series' title on the chart: "<indicator> · <line>", or none at all when labels are off (T-047). */
  private title(seriesLabel: string, keyLabel: string): string {
    return this.labels() ? `${seriesLabel} · ${keyLabel}` : '';
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

/** A key's points onto its series; a histogram's bars carry their sign colour (T-057). */
function setKeyData(target: KeySeries, key: KeySpec, sorted: readonly IndicatorPoint[]): void {
  const defined = sorted.filter((p) => typeof p.values[key.key] === 'number');
  if (key.plot === 'histogram') {
    (target as ISeriesApi<'Histogram'>).setData(
      defined.map((p) => {
        const value = p.values[key.key] as number;
        return { time: msToTime(p.time), value, color: value >= 0 ? HISTOGRAM_UP : HISTOGRAM_DOWN };
      }),
    );
    return;
  }
  (target as ISeriesApi<'Line'>).setData(defined.map((p) => ({ time: msToTime(p.time), value: p.values[key.key] as number })));
}

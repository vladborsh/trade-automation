import type { Candle, IndicatorPoint, IndicatorSeriesSpec, InstrumentId, SessionPanelIndicator, Timeframe } from '@trade-automation/contracts';
import { INDICATOR_CATALOG, computeAtr, defaultParams, indicatorById, type IndicatorCatalogEntry } from '@trade-automation/indicators';

/**
 * T-028 — the indicators of one backtest panel, computed on the client (decision 11) from the
 * panel's current timeframe bars (closed + forming) with `libs/indicators`' catalogue, and shaped
 * for the chart's existing `IndicatorLayer` (`indicatorPoints` + `indicatorSpecs`). Pure.
 */

/** `IndicatorPoint.strategyId` of replay indicators; the layer groups by `${strategyId}:${seriesId}`. */
export const REPLAY_INDICATOR_SOURCE = 'replay';

/** Line colours per output, in order (the dark-terminal palette's accents). */
const OUTPUT_COLORS = ['#d29922', '#58a6ff', '#bc8cff', '#26a69a', '#ef5350'];

export interface PanelIndicatorsView {
  points: IndicatorPoint[];
  specs: Map<string, IndicatorSeriesSpec>;
}

/** The catalogue's defaults overlaid with the panel's stored params (unknown keys dropped). */
export function effectiveParams(entry: IndicatorCatalogEntry, params: Readonly<Record<string, unknown>>): Record<string, number> {
  const out = defaultParams(entry);
  for (const p of entry.params) {
    const v = params[p.key];
    if (typeof v === 'number' && Number.isFinite(v)) out[p.key] = v;
  }
  return out;
}

/** `EMA (21)`, `MACD (12, 26, 9)`; an entry without params is just its id, `VWAP`. */
export function indicatorLabel(entry: IndicatorCatalogEntry, params: Readonly<Record<string, number>>): string {
  const id = entry.id.toUpperCase();
  return entry.params.length === 0 ? id : `${id} (${entry.params.map((p) => params[p.key]).join(', ')})`;
}

/**
 * Every configured indicator of the panel over `bars`: one `IndicatorPoint` per bar time per
 * instance (outputs not yet defined are null, i.e. a gap) and one spec per instance —
 * `scale: 'pane'` for the catalogue's separate-pane entries. Unknown ids (e.g. an entry a newer
 * catalogue removed) and params the function refuses are skipped, never thrown into the chart.
 */
export function panelIndicators(
  bars: readonly Candle[],
  indicators: readonly SessionPanelIndicator[] | undefined,
  instrument: InstrumentId,
  timeframe: Timeframe,
): PanelIndicatorsView {
  const points: IndicatorPoint[] = [];
  const specs = new Map<string, IndicatorSeriesSpec>();
  (indicators ?? []).forEach((ind, i) => {
    const entry = indicatorById(ind.id);
    if (!entry || bars.length === 0) return;
    const params = effectiveParams(entry, ind.params);
    let series: Record<string, { time: number; value: number }[]>;
    try {
      series = entry.compute(bars, params);
    } catch {
      return; // invalid params: nothing drawn for this instance
    }
    const seriesId = `${entry.id}-${i}`;
    specs.set(`${REPLAY_INDICATOR_SOURCE}:${seriesId}`, {
      id: seriesId,
      label: indicatorLabel(entry, params),
      scale: entry.pane === 'separate' ? 'pane' : 'price',
      ...(entry.range ? { range: { ...entry.range } } : {}),
      ...(entry.levels ? { levels: [...entry.levels] } : {}),
      keys: entry.outputs.map((o, k) => ({ key: o.key, label: o.label, color: OUTPUT_COLORS[k % OUTPUT_COLORS.length] })),
    });
    const byTime = new Map<number, Record<string, number | null>>();
    for (const o of entry.outputs) {
      for (const v of series[o.key] ?? []) {
        const values = byTime.get(v.time) ?? Object.fromEntries(entry.outputs.map((x) => [x.key, null]));
        values[o.key] = v.value;
        byTime.set(v.time, values);
      }
    }
    for (const [time, values] of [...byTime.entries()].sort((a, b) => a[0] - b[0])) {
      points.push({ strategyId: REPLAY_INDICATOR_SOURCE, instrument, timeframe, tier: 'live', seriesId, time, values });
    }
  });
  return { points, specs };
}

/** ATR(14) of the panel's closed bars (the default position-tool stop, T-028); null until defined. */
export function panelAtr14(closedBars: readonly Candle[]): number | null {
  return computeAtr(closedBars, 14) ?? null;
}

/** A catalogue entry the picker can add: the defaults as the stored params. */
export function newIndicator(id: string): SessionPanelIndicator | null {
  const entry = indicatorById(id);
  return entry ? { id: entry.id, params: defaultParams(entry) } : null;
}

/**
 * A parameter value the picker accepts, per the catalogue's spec (a number within [min, max], an
 * integer where required); null otherwise, so the picker refuses it without a request.
 */
export function acceptParam(entry: IndicatorCatalogEntry, key: string, raw: string): number | null {
  const spec = entry.params.find((p) => p.key === key);
  const value = Number(raw);
  if (!spec || raw.trim() === '' || !Number.isFinite(value)) return null;
  if (value < spec.min || value > spec.max || (spec.integer && !Number.isInteger(value))) return null;
  return value;
}

/** The catalogue, for the picker (never re-listed in the client). */
export const CATALOG = INDICATOR_CATALOG;

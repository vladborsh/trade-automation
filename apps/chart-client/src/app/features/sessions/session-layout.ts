import type { InstrumentId, Layout, LayoutGrid, SessionLayout } from '@trade-automation/contracts';

/** backtest-app-system-design.md D10 — a session layout holds 1..4 candle panels. */
export const MAX_SESSION_PANELS = 4;

/**
 * A `GET /api/layouts` preset as the create form offers it (D10): metric panels stripped, and
 * disabled when more than 4 candle panels remain or none of its instruments has stored 1m.
 * A candle panel whose instrument has no stored 1m is left out of the preset (listed in
 * `unavailable` so the form can say so) rather than disabling the whole preset.
 */
export interface PresetOption {
  id: string;
  name: string;
  grid: LayoutGrid;
  /** Candle panels whose instrument is available, in preset order. */
  panels: { id: string; instrument: InstrumentId; title?: string }[];
  unavailable: InstrumentId[];
  disabledReason: string | null;
}

export function presetOptions(layouts: readonly Layout[], available: ReadonlySet<InstrumentId>): PresetOption[] {
  return layouts.map((layout) => {
    const candles = layout.panels.filter((p) => p.kind === 'candles');
    const panels = candles
      .filter((p) => available.has(p.instrument))
      .map((p) => ({ id: p.id, instrument: p.instrument, ...(p.title ? { title: p.title } : {}) }));
    const unavailable = [...new Set(candles.filter((p) => !available.has(p.instrument)).map((p) => p.instrument))];
    let disabledReason: string | null = null;
    if (candles.length > MAX_SESSION_PANELS) {
      disabledReason = `${candles.length} candle panels; a session holds at most ${MAX_SESSION_PANELS}.`;
    } else if (panels.length === 0) {
      disabledReason = 'None of its instruments has stored 1m history.';
    }
    return { id: layout.id, name: layout.name, grid: layout.grid, panels, unavailable, disabledReason };
  });
}

/** A panel id the contract accepts (`^[a-z0-9-]+$`), from an instrument id. */
export function panelIdFor(instrument: InstrumentId): string {
  return instrument.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * The session's own copy of a layout (§7.2), one candle panel per selected instrument. With a
 * preset, its panels keep their id and title and come first in preset order, and the preset's
 * grid is kept while it has room; otherwise the panels sit in one row.
 */
export function buildSessionLayout(instruments: readonly InstrumentId[], preset: PresetOption | null): SessionLayout {
  const fromPreset = (preset?.panels ?? []).filter((p) => instruments.includes(p.instrument));
  const taken = new Set(fromPreset.map((p) => p.instrument));
  const usedIds = new Set(fromPreset.map((p) => p.id));
  const extra = instruments
    .filter((i) => !taken.has(i))
    .map((instrument) => {
      let id = panelIdFor(instrument);
      for (let n = 2; usedIds.has(id); n++) id = `${panelIdFor(instrument)}-${n}`;
      usedIds.add(id);
      return { id, instrument };
    });
  const panels = [...fromPreset, ...extra].map((p) => ({ ...p, kind: 'candles' as const, signals: false }));
  const fits = preset !== null && panels.length <= preset.grid.columns * preset.grid.rows;
  return {
    id: preset?.id ?? 'custom',
    name: preset?.name ?? 'Custom',
    grid: fits ? preset.grid : { columns: Math.max(1, panels.length), rows: 1 },
    panels,
  };
}

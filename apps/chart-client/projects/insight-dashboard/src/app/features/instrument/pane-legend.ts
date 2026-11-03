import type { StringKey } from '../../i18n/keys';
import type { PaneData } from './pane-data';
import { PANELS, panelHeading, type PanelDef } from './panels.model';
import { EVENT_LINE_COLOUR } from './calendar-marks';
import { LEVEL_COLOURS } from './prior-levels';
import { SESSIONS, showsSessions } from './trading-sessions';
import { CLOSED_BAND_SWATCH, showsClosedBands } from './weekend-bands';

/**
 * One pane's legend, drawn over its top-left corner: the panel's own entries, and on the price
 * pane the overlays drawn over it (2026-10-24): the session bands, when the timeframe shows them,
 * and the previous day and week levels; and (IB-060) the economic-event lines and the
 * weekend / US-holiday bands, the latter where the timeframe shows them.
 */
export interface LegendEntry {
  label: string;
  /** Null for an entry that is a statement, not a key to a colour. */
  colour: string | null;
  /** Drawn as a short line rather than a block: the entry keys a line series. */
  line: boolean;
}

export function legendEntries(
  panel: PanelDef,
  data: Pick<PaneData, 'timeframe'> | null,
  t: (key: StringKey) => string,
): LegendEntry[] {
  const own = panel.legend.map((e) => ({ label: t(e.labelKey), colour: e.colour, line: false }));
  if (panel.key !== 'price' || !data) return own;
  const sessions = showsSessions(data.timeframe)
    ? SESSIONS.map((s) => ({ label: t(s.labelKey), colour: s.swatch, line: false }))
    : [];
  const closed = showsClosedBands(data.timeframe)
    ? [{ label: t('instrument.legend.usClosed'), colour: CLOSED_BAND_SWATCH, line: false }]
    : [];
  return [
    ...own,
    ...sessions,
    { label: t('instrument.legend.prevDay'), colour: LEVEL_COLOURS.day, line: true },
    { label: t('instrument.legend.prevWeek'), colour: LEVEL_COLOURS.week, line: true },
    { label: t('instrument.legend.usdEvents'), colour: EVENT_LINE_COLOUR, line: true },
    ...closed,
  ];
}

/**
 * Every pane's legend box: its heading, its entries, at its pane's top edge (`paneEdges`), in
 * `PANELS` order. Moved out of the chart component (IB-098) — it is mapping, not wiring.
 */
export function paneLegends(
  t: (key: StringKey) => string,
  data: Pick<PaneData, 'timeframe'> | null,
  symbol: string,
  edges: ReadonlyArray<{ top: number }>,
): Array<{ key: PanelDef['key']; heading: string; entries: LegendEntry[]; top: number }> {
  return PANELS.map((panel, i) => ({
    key: panel.key,
    heading: panelHeading(t, panel, symbol),
    entries: legendEntries(panel, data, t),
    top: edges[i].top,
  }));
}

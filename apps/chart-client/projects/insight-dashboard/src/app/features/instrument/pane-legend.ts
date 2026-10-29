import type { StringKey } from '../../i18n/keys';
import type { PaneData } from './pane-data';
import type { PanelDef } from './panels.model';
import { LEVEL_COLOURS } from './prior-levels';
import { SESSIONS, showsSessions } from './trading-sessions';

/**
 * One pane's legend, drawn over its top-left corner: the panel's own entries, and on the price
 * pane the overlays drawn over it (2026-10-24): the session bands, when the timeframe shows them,
 * and the previous day and week levels.
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
  return [
    ...own,
    ...sessions,
    { label: t('instrument.legend.prevDay'), colour: LEVEL_COLOURS.day, line: true },
    { label: t('instrument.legend.prevWeek'), colour: LEVEL_COLOURS.week, line: true },
  ];
}

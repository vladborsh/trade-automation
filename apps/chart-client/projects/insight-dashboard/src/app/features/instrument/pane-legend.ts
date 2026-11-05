import type { OiDivergenceKind } from '@trade-automation/contracts';
import { DIVERGENCE_COLOURS, OI_CONTRACTS_COLOUR } from './oi-divergence-lines';
import type { StringKey } from '../../i18n/keys';
import { noAnswerLabel, seriesStartLabel, type CoverageLabel } from './coverage-labels';
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
  /**
   * IB-110: the entry is a switch for what it keys (the divergence lines); `off` when they are hidden.
   * IB-144 (V44): one switch per kind — 'regular' («Дивергенции OI»), 'hidden' («Скрытые дивергенции OI»).
   */
  toggle?: OiDivergenceKind;
  off?: boolean;
  /** IB-144: the swatch is drawn dotted (the hidden lines are dotted on the chart). */
  dotted?: boolean;
}

/** IB-144: which kinds of divergence line the reader hid, one switch each (`divergence-prefs.ts`). */
export type DivergencesOff = Readonly<Record<OiDivergenceKind, boolean>>;
export const NONE_OFF: DivergencesOff = { regular: false, hidden: false };

/** What the legend reads: the timeframe always, and (IB-081) the coverage the server stated. */
export type LegendData = Pick<PaneData, 'timeframe'> & Partial<Pick<PaneData, 'funding' | 'longShort' | 'openInterestCoverage' | 'divergences'>>;

type Translate = (key: StringKey, params?: Record<string, string>) => string;

export function legendEntries(
  panel: PanelDef,
  data: LegendData | null,
  t: Translate,
  off: DivergencesOff = NONE_OFF,
): LegendEntry[] {
  // IB-110: on the two panes the lines are drawn on, whenever this frame has them (an empty list included);
  // IB-144: two switches, the regular lines and the hidden ones, each independent of the other
  const divergences: LegendEntry[] = data?.divergences !== undefined && (panel.key === 'price' || panel.key === 'openInterest')
    ? [
      { label: t('instrument.legend.divergences'), colour: DIVERGENCE_COLOURS.bullish, line: true, toggle: 'regular', off: off.regular },
      { label: t('instrument.legend.hiddenDivergences'), colour: DIVERGENCE_COLOURS.bullish, line: true, toggle: 'hidden', off: off.hidden, dotted: true },
    ]
    : [];
  // TL review: while OI strokes are drawn, the OI pane also carries the contracts line they sit on (the lines in
  // the data are the ones not switched off — `divergence-overlay.ts`)
  const contracts: LegendEntry[] = panel.key === 'openInterest' && (data?.divergences?.length ?? 0) > 0
    ? [{ label: t('instrument.legend.oiContracts'), colour: OI_CONTRACTS_COLOUR, line: true }]
    : [];
  const own = [...panel.legend.map((e) => ({ label: t(e.labelKey), colour: e.colour, line: false })), ...contracts, ...divergences];
  const note = data ? coverageNote(panel.key, data) : null;
  if (note) return [...own, { label: t(note.key, note.params), colour: null, line: false }];
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
 * IB-081 — the statement a pane adds about its own data: where the OI or long/short series begins
 * when that is later than the window, and which venue's funding did not answer. A statement, so no
 * swatch (`colour: null`). Null when the server said nothing worth saying (`coverage-labels.ts`).
 */
function coverageNote(key: PanelDef['key'], data: LegendData): CoverageLabel | null {
  if (key === 'openInterest') return seriesStartLabel(data.openInterestCoverage);
  if (key === 'longShort') return seriesStartLabel(data.longShort);
  if (key === 'funding') return noAnswerLabel(data.funding?.unavailable);
  return null;
}

/**
 * Every pane's legend box: its heading, its entries, at its pane's top edge (`paneEdges`), in
 * `PANELS` order. Moved out of the chart component (IB-098) — it is mapping, not wiring.
 */
export function paneLegends(
  t: Translate,
  data: LegendData | null,
  symbol: string,
  edges: ReadonlyArray<{ top: number }>,
  off: DivergencesOff = NONE_OFF,
): Array<{ key: PanelDef['key']; heading: string; entries: LegendEntry[]; top: number }> {
  return PANELS.map((panel, i) => ({
    key: panel.key,
    heading: panelHeading(t, panel, symbol),
    entries: legendEntries(panel, data, t, off),
    top: edges[i].top,
  }));
}

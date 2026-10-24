import type { StringKey } from '../../i18n/keys';
import type { PaneData } from './pane-data';
import type { PanelDef } from './panels.model';
import { SPOT_LINE_COLOUR } from './panel-series';

/**
 * One pane's legend, drawn over its top-left corner: the panel's own entries, and on the price
 * pane one more that says what the spot line is, or why there is none.
 *
 * The "why" matters: a price pane with no spot line looks the same whether the coin has no spot
 * market or the read failed, and those are different facts.
 */
export interface LegendEntry {
  label: string;
  /** Null for an entry that is a statement, not a key to a colour. */
  colour: string | null;
  /** Drawn as a short line rather than a block: the spot series is a line. */
  line: boolean;
}

export function legendEntries(
  panel: PanelDef,
  data: Pick<PaneData, 'spotState'> | null,
  t: (key: StringKey) => string,
): LegendEntry[] {
  const own = panel.legend.map((e) => ({ label: t(e.labelKey), colour: e.colour, line: false }));
  if (panel.key !== 'price' || !data) return own;
  switch (data.spotState) {
    case 'shown':
      return [...own, { label: t('instrument.legend.spot'), colour: SPOT_LINE_COLOUR, line: true }];
    case 'none':
      return [...own, { label: t('instrument.legend.noSpot'), colour: null, line: false }];
    case 'failed':
      return [...own, { label: t('instrument.legend.spotFailed'), colour: null, line: false }];
  }
}

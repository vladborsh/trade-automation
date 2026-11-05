import type { WebPositioningSignal } from '@trade-automation/contracts';
import type { StringKey } from '../../i18n/keys';
import type { Heat } from './pos-layout';

/**
 * IB-121 (market-round2 design §5) — what the heat table's help lists, as data.
 *
 * The swatches are one per level `heatOf` can give a measured-or-not cell, minus `typical` (no fill):
 * the help draws each with the table's own `data-heat` rules (`_heat.scss`), so the two cannot drift.
 */
export const HEAT_HELP_LEVELS: readonly { heat: Exclude<Heat, 'typical'>; key: StringKey }[] = [
  { heat: 'notable', key: 'positioning.help.level.notable' },
  { heat: 'unusual', key: 'positioning.help.level.unusual' },
  { heat: 'extreme', key: 'positioning.help.level.extreme' },
  { heat: 'none', key: 'positioning.help.level.none' },
];

/**
 * Every word the rules can put in the «Сигнал» column (contract `WEB_POSITIONING_SIGNALS`, the closed
 * set of `positioning.rules.ts`), plus the empty cell (`signal: null`), in the mockup's order. The two
 * crowd signals share one line («толпа в лонгах / шортах»), as the mockup words it.
 */
export const SIGNAL_HELP = [
  { signals: ['squeeze'], label: 'positioning.signal.squeeze', text: 'positioning.help.signal.squeeze' },
  { signals: ['capitulation'], label: 'positioning.signal.capitulation', text: 'positioning.help.signal.capitulation' },
  { signals: ['crowded_long', 'crowded_short'], label: 'positioning.help.signal.crowded', text: 'positioning.help.signal.crowdedText' },
  { signals: ['quiet'], label: 'positioning.signal.quiet', text: 'positioning.help.signal.quiet' },
  { signals: [], label: 'positioning.help.signal.empty', text: 'positioning.help.signal.emptyText' },
] as const satisfies readonly { signals: readonly WebPositioningSignal[]; label: StringKey; text: StringKey }[];

/**
 * A signal the rules can emit but the help does not explain FAILS THE BUILD (the task's spec): add a
 * value to `WEB_POSITIONING_SIGNALS` and this line stops compiling until `SIGNAL_HELP` names it.
 */
type Unexplained = Exclude<WebPositioningSignal, (typeof SIGNAL_HELP)[number]['signals'][number]>;
export const SIGNAL_HELP_IS_EXHAUSTIVE: [Unexplained] extends [never] ? true : Unexplained = true;

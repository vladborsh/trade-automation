import type { WebChartCustomLevel } from '@trade-automation/contracts';
import { CUSTOM_LEVEL_COLOUR } from './prior-levels';

/**
 * IB-128 (alerts design §4 P9, §5) — an admin's custom levels as the price pane draws them: one horizontal price line
 * each, across the whole chart (a custom level has no period), titled on the price axis with its id and the owner's
 * note so a line can be matched to `/level del <id>`. None while their legend switch is off.
 */
export const CUSTOM_LEVEL_TITLE_MAX = 24;

export interface CustomLevelLine { price: number; title: string; colour: string }

export function customLevelLines(levels: readonly WebChartCustomLevel[] | undefined, off: boolean): CustomLevelLine[] {
  if (!levels || off) return [];
  return levels.map((l) => ({ price: l.price, colour: CUSTOM_LEVEL_COLOUR, title: titleOf(l) }));
}

function titleOf(l: WebChartCustomLevel): string {
  const t = l.note ? `#${l.id} ${l.note}` : `#${l.id}`;
  return t.length > CUSTOM_LEVEL_TITLE_MAX ? `${t.slice(0, CUSTOM_LEVEL_TITLE_MAX - 1)}…` : t;
}

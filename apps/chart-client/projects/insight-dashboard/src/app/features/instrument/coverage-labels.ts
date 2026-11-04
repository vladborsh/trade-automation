import { venueName } from '@trade-automation/contracts';
import type { StringKey } from '../../i18n/keys';

/**
 * IB-081 — what a panel says about where its series begins, and which venue did not answer.
 *
 * The server already says both (WD-008/WD-009), and the panels ignored it. The result looked like
 * a quiet market where there was simply no data: a series that starts late, or a venue that
 * failed, drawn as if nothing happened. That is the same class of error as IB-BUG-011.
 *
 * - **OI and long/short** carry `coverageFrom` (the first instant the answer covers) and
 *   `truncated` (the series starts later than the window asked for). Only `truncated === true`
 *   earns the label. `coverageFrom` alone is the server stating where the answer starts. Inside
 *   the window it is not news, so it shows nothing.
 * - **Funding** carries `unavailable`, the venues that did not answer. A missing or empty field
 *   means every venue answered.
 *
 * Venue names are identifiers and are shown as the server names them, as `venueNote` does on the
 * liquidations page. Only the phrase around them is translated.
 */
export interface Coverage {
  coverageFrom?: number;
  truncated?: boolean;
}

export interface CoverageLabel {
  key: StringKey;
  params: Record<string, string>;
}

/** «данные с 2026-10-05» when the series starts later than the window, else null. */
export function seriesStartLabel(coverage: Coverage | undefined): CoverageLabel | null {
  if (coverage?.truncated !== true || coverage.coverageFrom === undefined) return null;
  return { key: 'instrument.coverage.from', params: { date: utcDate(coverage.coverageFrom) } };
}

/** «нет ответа: Bybit, OKX» when a venue did not answer, else null (names, not keys: IB-BUG-033). */
export function noAnswerLabel(unavailable: readonly string[] | undefined): CoverageLabel | null {
  if (!unavailable || unavailable.length === 0) return null;
  return { key: 'instrument.coverage.noAnswer', params: { venues: [...new Set(unavailable)].map(venueName).join(', ') } };
}

/** The UTC calendar day of an epoch second, `YYYY-MM-DD`: the format Market's «доступно с» uses. */
export function utcDate(epochSec: number): string {
  return new Date(epochSec * 1000).toISOString().slice(0, 10);
}

/**
 * The coverage of a series made by joining an EARLIER read onto the one on screen (scrolling
 * left), as the server would state it for the joined window.
 * - It is truncated exactly when the earlier read was. If the earlier read reached its whole
 *   window, the joined one did too, whatever the later read said about its own start.
 * - It begins at the joined series' first point. A wholly empty earlier read (a window before the
 *   venue's retention) states the retention edge as its `coverageFrom`. The drawn series still
 *   begins at the later read's first point, so the label must say that date.
 */
export function joinedCoverage(earlier: Coverage | undefined, joinedFirstTime: number | undefined): Coverage {
  if (earlier?.truncated !== true) return {};
  return { coverageFrom: joinedFirstTime ?? earlier.coverageFrom, truncated: true };
}

/**
 * Funding's `unavailable` for two reads shown together: a venue missing from either read is
 * missing from part of what is drawn. Undefined when both answered in full, so "every venue
 * answered" stays the absence of the field.
 */
export function joinedUnavailable(a: readonly string[] | undefined, b: readonly string[] | undefined): string[] | undefined {
  const all = [...new Set([...(a ?? []), ...(b ?? [])])];
  return all.length === 0 ? undefined : all;
}

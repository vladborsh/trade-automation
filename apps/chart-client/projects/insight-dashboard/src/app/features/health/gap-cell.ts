import type { WebStreamHealthRow } from '@trade-automation/contracts';
import type { StringKey } from '../../i18n/keys';

/**
 * IB-104 — the «open gaps» cell of the health page's stream table.
 *
 * The number is OURS (we failed to record), in warning colour when above zero. Gaps the venue did
 * not publish while we were recording are a note beside it, informational and never in warning
 * colour. On the box those are Binance's TradFi perps on closed sessions, ~238 of them. Shown as a
 * warning for ever, they would train the reader to skip the row that has to catch an outage.
 */
export interface GapCell {
  ours: number;
  warn: boolean;
  venueNote: { key: StringKey; params: Record<string, number> } | null;
}

export function gapCell(row: Pick<WebStreamHealthRow, 'gapsOpen'> & Partial<Pick<WebStreamHealthRow, 'gapsVenue'>>): GapCell {
  const venue = row.gapsVenue ?? 0;
  return {
    ours: row.gapsOpen,
    warn: row.gapsOpen > 0,
    venueNote: venue > 0 ? { key: 'health.gapsVenue', params: { count: venue } } : null,
  };
}

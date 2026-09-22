import type { Order } from '@trade-automation/contracts';
import {
  type OrderFlag,
  formatMoney,
  formatQtyUnit,
  formatPrice,
  formatR,
  formatRAmount,
  formatSignedMoney,
  formatUtc,
  orderFlags,
} from './journal-format';

/** One journal cell: what is shown, and the server's raw value (an e2e/diff hook, `data-value`). */
export interface JournalCell {
  field: keyof Order;
  text: string;
  raw: string | number | boolean | null;
  title?: string;
}

export interface JournalRow {
  id: string;
  seq: number;
  side: Order['side'];
  cells: JournalCell[];
  flags: OrderFlag[];
  /** For colouring: the server's P&L sign, or null while the trade is not closed. */
  pnlSign: -1 | 0 | 1 | null;
}

const cell = (field: keyof Order, text: string, raw: JournalCell['raw'], title?: string): JournalCell => ({ field, text, raw, title });

/**
 * backtest-app-system-design.md §7.2 — one order as a journal row. Display only: every figure is a
 * server field, formatted; costs are shown as the server's two columns, never summed.
 */
export function journalRow(o: Order, pricePrecision: number | undefined, currency: string, unit?: string): JournalRow {
  const price = (v: number | null) => formatPrice(v, pricePrecision);
  return {
    id: o.id,
    seq: o.seq,
    side: o.side,
    flags: orderFlags(o),
    pnlSign: o.pnlCcy === null ? null : (Math.sign(o.pnlCcy) as -1 | 0 | 1),
    cells: [
      cell('seq', String(o.seq), o.seq),
      cell('instrument', o.instrument, o.instrument),
      cell('side', o.side, o.side),
      cell('type', o.type, o.type),
      cell('status', o.status, o.status),
      cell('placedAtMs', formatUtc(o.placedAtMs), o.placedAtMs),
      cell('entryPrice', price(o.entryPrice), o.entryPrice, o.entryTimeMs === null ? undefined : `filled ${formatUtc(o.entryTimeMs)} UTC`),
      // T-033: the stop as it stands (or stood at the exit); a moved stop says where it started
      cell('slCurrent', price(o.slCurrent), o.slCurrent, o.slCurrent === o.slInitial ? undefined : `moved from ${price(o.slInitial)}`),
      cell('exitPrice', price(o.exitPrice), o.exitPrice, o.exitTimeMs === null ? undefined : `closed ${formatUtc(o.exitTimeMs)} UTC`),
      cell('closeReason', o.closeReason ?? '—', o.closeReason),
      cell('qty', formatQtyUnit(o.qty, unit), o.qty),
      cell('commissionCcy', formatMoney(o.commissionCcy, currency), o.commissionCcy),
      cell('spreadCostCcy', formatMoney(o.spreadCostCcy, currency), o.spreadCostCcy),
      cell('pnlCcy', formatSignedMoney(o.pnlCcy, currency), o.pnlCcy),
      cell('pnlR', formatR(o.pnlR), o.pnlR),
      // MAE is a magnitude (replay-core `computeMae`: the worst adverse excursion, never below 0).
      cell('maeR', formatRAmount(o.maeR), o.maeR, 'Maximum adverse excursion'),
    ],
  };
}

/** Column headings, in the order of `JournalRow.cells`. */
export const JOURNAL_COLUMNS = [
  '#', 'Instrument', 'Side', 'Type', 'Status', 'Placed', 'Entry', 'SL', 'Exit', 'Close', 'Qty', 'Commission', 'Spread', 'P&L', 'R', 'MAE',
] as const;

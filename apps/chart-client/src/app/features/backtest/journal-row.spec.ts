import type { Order } from '@trade-automation/contracts';
import { JOURNAL_COLUMNS, journalRow } from './journal-row';

const ORDER = {
  id: 'o1', seq: 3, instrument: 'binance:BTCUSDT', side: 'long', type: 'market', status: 'closed',
  placedAtMs: Date.UTC(2026, 8, 16, 10, 5), entryPrice: 76_800.5, entryTimeMs: Date.UTC(2026, 8, 16, 10, 5),
  exitPrice: 76_950, exitTimeMs: Date.UTC(2026, 8, 16, 11, 0), closeReason: 'take-profit', qty: 0.013,
  commissionCcy: 1.2, spreadCostCcy: 0.4, pnlCcy: 194.35, pnlR: 1.94, maeR: -0.35,
  fillResolution: '1m', slTpSameBar: false,
} as unknown as Order;

describe('journalRow', () => {
  it('shows the server fields formatted, one cell per column, with the raw value kept', () => {
    const row = journalRow(ORDER, 2, 'USD');
    expect(row.cells).toHaveLength(JOURNAL_COLUMNS.length);
    expect(row.cells.map((c) => c.text)).toEqual([
      '3', 'binance:BTCUSDT', 'long', 'market', 'closed', '2026-09-16 10:05', '76800.50', '76950.00', 'take-profit', '0.013',
      '1.20 USD', '0.40 USD', '+194.35 USD', '+1.94 R', '−0.35 R',
    ]);
    expect(row.cells.find((c) => c.field === 'pnlCcy')?.raw).toBe(194.35);
    expect(row.cells.find((c) => c.field === 'exitPrice')?.title).toBe('closed 2026-09-16 11:00 UTC');
    expect(row.pnlSign).toBe(1);
    expect(row.flags).toEqual([]);
  });

  it('a pending order shows dashes, no P&L sign, and never sums or derives anything', () => {
    const row = journalRow({ ...ORDER, status: 'pending', entryPrice: null, entryTimeMs: null, exitPrice: null, exitTimeMs: null, closeReason: null, pnlCcy: null, pnlR: null, maeR: null }, 2, 'USD');
    expect(row.cells.filter((c) => c.text === '—').map((c) => c.field)).toEqual(['entryPrice', 'exitPrice', 'closeReason', 'pnlCcy', 'pnlR', 'maeR']);
    expect(row.pnlSign).toBeNull();
  });

  it('carries the flags', () => {
    const row = journalRow({ ...ORDER, fillResolution: 'pessimistic-bar', closeReason: 'end-of-session' }, 2, 'USD');
    expect(row.flags.map((f) => f.key)).toEqual(['pessimistic-bar', 'end-of-session']);
  });
});

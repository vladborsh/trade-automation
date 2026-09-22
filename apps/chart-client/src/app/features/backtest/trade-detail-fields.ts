import type { Order, OrderModification } from '@trade-automation/contracts';
import { formatMoney, formatPrice, formatR, formatRAmount, formatSignedMoney, formatUtc, orderFlags, formatQtyUnit } from './journal-format';

export interface DetailField {
  field: keyof Order;
  label: string;
  text: string;
  /** The server's raw value — the same `data-value` hook as the journal. */
  raw: string | number | boolean | null;
}

/**
 * backtest-app-system-design.md §9.3 — the order row on the trade detail page: levels, fill prices
 * and times, quantity, risk, the costs split into commission and spread, P&L in currency and R,
 * MAE, close reason and how the fill/exit was resolved. Display only: every figure is a server field.
 */
export function tradeDetailFields(o: Order, currency: string, pricePrecision: number | undefined, unit?: string): DetailField[] {
  const price = (v: number | null) => formatPrice(v, pricePrecision);
  const f = (field: keyof Order, label: string, text: string): DetailField => ({ field, label, text, raw: o[field] as DetailField['raw'] });
  return [
    f('seq', 'Trade', `#${o.seq}`),
    f('instrument', 'Instrument', o.instrument),
    f('side', 'Side', o.side),
    f('type', 'Type', o.type),
    f('status', 'Status', o.status),
    f('placedAtMs', 'Placed', `${formatUtc(o.placedAtMs)} UTC`),
    f('limitPrice', 'Limit', price(o.limitPrice)),
    f('slInitial', 'Stop (initial)', price(o.slInitial)),
    f('slCurrent', 'Stop (current)', price(o.slCurrent)),
    f('tpInitial', 'Target (initial)', price(o.tpInitial)),
    f('tpCurrent', 'Target (current)', price(o.tpCurrent)),
    f('entryPrice', 'Entry', price(o.entryPrice)),
    f('entryTimeMs', 'Filled', o.entryTimeMs === null ? '—' : `${formatUtc(o.entryTimeMs)} UTC`),
    f('exitPrice', 'Exit', price(o.exitPrice)),
    f('exitTimeMs', 'Closed', o.exitTimeMs === null ? '—' : `${formatUtc(o.exitTimeMs)} UTC`),
    f('closeReason', 'Close reason', o.closeReason ?? '—'),
    f('qty', 'Quantity', formatQtyUnit(o.qty, unit)),
    f('riskPct', 'Risk', `${o.riskPct} %`),
    f('riskAmountCcy', 'Risk amount', formatMoney(o.riskAmountCcy, currency)),
    f('commissionCcy', 'Commission', formatMoney(o.commissionCcy, currency)),
    f('spreadCostCcy', 'Spread', formatMoney(o.spreadCostCcy, currency)),
    f('pnlCcy', 'P&L', formatSignedMoney(o.pnlCcy, currency)),
    f('pnlR', 'P&L (R)', formatR(o.pnlR)),
    f('maePrice', 'MAE (price)', o.maePrice === null ? '—' : price(o.maePrice)),
    f('maeR', 'MAE (R)', formatRAmount(o.maeR)),
    f('fillResolution', 'Resolved on', resolutionText(o)),
  ];
}

function resolutionText(o: Order): string {
  if (o.fillResolution === null) return '—';
  const flags = orderFlags(o).filter((x) => x.key !== 'end-of-session').map((x) => x.title);
  return [o.fillResolution === '1m' ? '1m path' : 'bars', ...flags].join(' · ');
}

/** One stop/target move (decision 23): when, which level, from → to. */
export function modificationText(m: OrderModification, pricePrecision: number | undefined): string {
  const level = m.field === 'sl' ? 'Stop' : 'Target';
  return `${formatUtc(m.cursorMs)} UTC — ${level} ${formatPrice(m.oldValue, pricePrecision)} → ${formatPrice(m.newValue, pricePrecision)}`;
}

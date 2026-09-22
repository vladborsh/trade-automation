import type { Order } from '@trade-automation/contracts';

/**
 * Display only (decisions 5, 38): these helpers format the server's numbers and never derive new
 * ones. A null — no entry yet, no exit yet, no losses to divide by — shows as an em dash.
 */
const DASH = '—';

const fixed = (v: number, digits: number) =>
  Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Signed money: `+12.50 USD`, `−3.20 USD` (a true minus sign), `0.00 USD`. */
export function formatSignedMoney(v: number | null, currency: string): string {
  if (v === null) return DASH;
  return `${sign(v)}${fixed(v, 2)} ${currency}`;
}

/** A quantity in its contract unit (T-054, D12): `0.076 BTC`; the bare number when the unit is unknown. */
export function formatQtyUnit(qty: number, unit: string | undefined): string {
  return unit ? `${qty} ${unit}` : String(qty);
}

/** An unsigned amount (costs, drawdown): `4.10 USD`. */
export function formatMoney(v: number | null, currency: string): string {
  return v === null ? DASH : `${fixed(v, 2)} ${currency}`;
}

/** R multiple, signed: `+1.50 R`. */
export function formatR(v: number | null): string {
  return v === null ? DASH : `${sign(v)}${fixed(v, 2)} R`;
}

/** An unsigned R amount (drawdown): `2.40 R`. */
export function formatRAmount(v: number | null): string {
  return v === null ? DASH : `${fixed(v, 2)} R`;
}

/** A value already in percent (the server's `maxDrawdownPct`): `12.3 %`. */
export function formatPercent(percent: number | null): string {
  return percent === null ? DASH : `${fixed(percent, 1)} %`;
}

/** A price at the instrument's precision; unknown precision falls back to 2. */
export function formatPrice(v: number | null, precision: number | undefined): string {
  return v === null ? DASH : v.toFixed(precision ?? 2);
}

/** A plain ratio (profit factor): `1.85`; null — no losing trade to divide by — is `n/a`. */
export function formatRatio(v: number | null): string {
  return v === null ? 'n/a' : fixed(v, 2);
}

/** Replay time, UTC, to the minute: `2026-09-16 10:05`. */
export function formatUtc(ms: number | null): string {
  return ms === null ? DASH : new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

export interface OrderFlag {
  key: 'pessimistic-bar' | 'end-of-session' | 'sl-tp-same-bar';
  label: string;
  /** The explanation shown on hover (brief: the flags must be visible and explained). */
  title: string;
}

/** The journal's warning badges for one order (decisions 4 and 28). */
export function orderFlags(order: Pick<Order, 'fillResolution' | 'closeReason' | 'slTpSameBar'>): OrderFlag[] {
  const flags: OrderFlag[] = [];
  if (order.fillResolution === 'pessimistic-bar') {
    flags.push({ key: 'pessimistic-bar', label: 'bars', title: 'Resolved on bars, not 1m: stop assumed first' });
  }
  if (order.slTpSameBar) {
    flags.push({ key: 'sl-tp-same-bar', label: 'SL+TP', title: 'SL and TP in one candle — stop taken' });
  }
  if (order.closeReason === 'end-of-session') {
    flags.push({ key: 'end-of-session', label: 'end', title: 'Closed at the end of the session, at the last price' });
  }
  return flags;
}

function sign(v: number): string {
  if (v > 0) return '+';
  return v < 0 ? '−' : '';
}

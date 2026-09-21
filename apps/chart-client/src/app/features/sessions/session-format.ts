import type { SessionLayout } from '@trade-automation/contracts';

/** Display helpers for the sessions screens. All times are UTC, the codebase's convention. */

/** `2021-06-01 12:30` (UTC). */
export function formatUtcMinute(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

/** `2021-06-01 12:30 → 2021-07-01 00:00 UTC`. */
export function formatPeriod(fromMs: number, toMs: number): string {
  return `${formatUtcMinute(fromMs)} → ${formatUtcMinute(toMs)} UTC`;
}

/** `10,250.50 USD`; negative values keep their sign. */
export function formatMoney(value: number, currency: string): string {
  return `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

/** `+1.50 R`, `−0.75 R`, `0.00 R`. */
export function formatR(r: number): string {
  const abs = Math.abs(r).toFixed(2);
  if (Number(abs) === 0) return '0.00 R';
  return `${r > 0 ? '+' : '−'}${abs} R`;
}

/** `+150.25 USD` / `−20.00 USD` for a PnL. */
export function formatPnl(value: number, currency: string): string {
  if (Number(Math.abs(value).toFixed(2)) === 0) return `0.00 ${currency}`;
  return `${value > 0 ? '+' : '−'}${formatMoney(Math.abs(value), currency)}`;
}

/** The instrument symbols of a session's panels: `BTCUSDT, ETHUSDT`. */
export function layoutInstruments(layout: SessionLayout): string {
  return [...new Set(layout.panels.map((p) => p.instrument.split(':')[1] ?? p.instrument))].join(', ');
}

/** Value for `<input type="datetime-local">`, read as UTC. */
export function toUtcInputValue(ms: number | null): string {
  return ms === null ? '' : new Date(ms).toISOString().slice(0, 16);
}

/** Parses a `datetime-local` value as UTC; null when empty or malformed. */
export function fromUtcInputValue(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

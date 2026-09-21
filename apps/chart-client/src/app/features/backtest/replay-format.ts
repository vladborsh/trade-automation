/** The cursor as the toolbar shows it: always UTC, to the minute (design §5.1 — the cursor is absolute ms). */
export function formatCursorUtc(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** An account amount in the session currency (decision 36: one currency per session). */
export function formatBalance(amount: number, currency: string): string {
  const n = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n} ${currency}`;
}

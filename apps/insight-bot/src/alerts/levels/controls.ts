import { createHash } from 'node:crypto';
import { LEVEL_BAR_SEC, LEVEL_RANDOM_PER_DAY } from '@trade-automation/contracts';

/**
 * IB-126 (design P7, after V25 and L8) — the `random` control: 2 of the 96 15m bars of each coin's UTC day, picked by a
 * hash of (symbol, day), so a restart or the history run (IB-127) picks the same bars. Returns the bars' OPEN moments
 * (epoch ms), ascending.
 */
const DAY_MS = 86_400_000;
const BAR_MS = LEVEL_BAR_SEC * 1_000;

export function randomBarOpens(symbol: string, dayStartMs: number): number[] {
  const perDay = DAY_MS / BAR_MS;
  const h = createHash('sha256').update(`level|${symbol}|${new Date(dayStartMs).toISOString().slice(0, 10)}`).digest();
  const picks: number[] = [];
  for (let i = 0; picks.length < LEVEL_RANDOM_PER_DAY && i < 8; i++) {
    const slot = h.readUInt32BE(i * 4) % perDay;
    if (!picks.includes(slot)) picks.push(slot);
  }
  return picks.sort((a, b) => a - b).map((slot) => dayStartMs + slot * BAR_MS);
}

/** Whether the bar opening at `openMs` is one of its day's picks. */
export function isRandomBar(symbol: string, openMs: number): boolean {
  return randomBarOpens(symbol, Math.floor(openMs / DAY_MS) * DAY_MS).includes(openMs);
}

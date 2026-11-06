import { createHash } from 'node:crypto';
import { FUNDING_CHECK_SEC, FUNDING_RANDOM_PER_DAY } from '@trade-automation/contracts';

/**
 * IB-124 (design F8, after V25 and L8) — the `random` control: 2 checks per coin and UTC day, on the 5-minute check
 * grid, picked by a hash of (symbol, day). A restart picks the same slots. Returns the slots' START moments (epoch ms),
 * ascending. The first check of the loop inside a slot, [start, start + 5 min), is the one recorded.
 */
const DAY_MS = 86_400_000;
export const FUNDING_SLOT_MS = FUNDING_CHECK_SEC * 1_000;

export function randomCheckSlots(symbol: string, dayStartMs: number): number[] {
  const perDay = DAY_MS / FUNDING_SLOT_MS;
  const h = createHash('sha256').update(`funding|${symbol}|${new Date(dayStartMs).toISOString().slice(0, 10)}`).digest();
  const picks: number[] = [];
  for (let i = 0; picks.length < FUNDING_RANDOM_PER_DAY && i < 8; i++) {
    const slot = h.readUInt32BE(i * 4) % perDay;
    if (!picks.includes(slot)) picks.push(slot);
  }
  return picks.sort((a, b) => a - b).map((slot) => dayStartMs + slot * FUNDING_SLOT_MS);
}

/** The picked slot that `atMs` falls in, or null. */
export function randomSlotAt(symbol: string, atMs: number): number | null {
  const day = Math.floor(atMs / DAY_MS) * DAY_MS;
  return randomCheckSlots(symbol, day).find((s) => atMs >= s && atMs < s + FUNDING_SLOT_MS) ?? null;
}

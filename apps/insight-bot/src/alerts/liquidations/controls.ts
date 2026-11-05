import { createHash } from 'node:crypto';
import { LIQ_RANDOM_PER_DAY, LIQ_WINDOW_SEC } from '@trade-automation/contracts';

/**
 * IB-122 (design L8, after V25) — the `random` control: 2 five-minute windows per coin and UTC day, on the
 * 5-minute grid, picked by a hash of (symbol, day) so a restart or a history run picks the same windows.
 * Returns the windows' END moments (epoch ms), ascending; the window is (end − 5 min, end].
 */
const DAY_MS = 86_400_000;
const SLOT_MS = LIQ_WINDOW_SEC * 1_000;

export function randomWindowEnds(symbol: string, dayStartMs: number): number[] {
  const perDay = DAY_MS / SLOT_MS;
  const h = createHash('sha256').update(`liq|${symbol}|${new Date(dayStartMs).toISOString().slice(0, 10)}`).digest();
  const picks: number[] = [];
  for (let i = 0; picks.length < LIQ_RANDOM_PER_DAY && i < 8; i++) {
    const slot = h.readUInt32BE(i * 4) % perDay;
    if (!picks.includes(slot)) picks.push(slot);
  }
  return picks.sort((a, b) => a - b).map((slot) => dayStartMs + (slot + 1) * SLOT_MS);
}

/** The UTC day a moment falls in, epoch ms. */
export const dayStartOf = (ms: number): number => Math.floor(ms / DAY_MS) * DAY_MS;

/**
 * A path's `t0` (the measurer needs the 5 m grid, migration 027): the event moment rounded UP to 5 min —
 * the first 5 m bar that opens after the event, so the path never includes the cascade's own bar.
 */
export function liqPathT0(atMs: number): number {
  return Math.ceil(atMs / 1000 / LIQ_WINDOW_SEC) * LIQ_WINDOW_SEC;
}

import type { Order } from '@trade-automation/contracts';

/** The fields a client preview (T-023) and the server's authoritative row must agree on (§5.5 step 6). */
const COMPARED: ReadonlyArray<keyof Order> = [
  'status',
  'entryPrice',
  'entryTimeMs',
  'exitPrice',
  'exitTimeMs',
  'closeReason',
  'fillResolution',
  'qty',
  'pnlCcy',
  'pnlR',
];

/**
 * Whether the client's preview of an order disagrees with the server's row. It should never
 * happen — both run the same replay-core code on the same bytes — so a difference is logged and
 * shown as a one-line "resynced" notice; the server row always wins.
 */
export function previewDiffers(preview: Order, server: Order): string[] {
  return COMPARED.filter((k) => preview[k] !== server[k]);
}

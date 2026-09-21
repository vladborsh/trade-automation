import type { Order } from '@trade-automation/contracts';
import { previewDiffers } from './reconcile';

const base = {
  id: 'o1', status: 'closed', entryPrice: 100, entryTimeMs: 1, exitPrice: 105, exitTimeMs: 2,
  closeReason: 'take-profit', fillResolution: '1m', qty: 2, pnlCcy: 10, pnlR: 2, updatedAt: 1,
} as unknown as Order;

describe('previewDiffers (§5.5 step 6)', () => {
  it('is empty when preview and server agree (bookkeeping fields such as updatedAt are ignored)', () => {
    expect(previewDiffers(base, { ...base, updatedAt: 99 })).toEqual([]);
  });

  it('names every field that differs', () => {
    expect(previewDiffers(base, { ...base, exitPrice: 104.5, pnlCcy: 9, closeReason: 'stop' })).toEqual(['exitPrice', 'closeReason', 'pnlCcy']);
  });
});

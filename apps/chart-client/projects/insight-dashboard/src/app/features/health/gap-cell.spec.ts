import { describe, expect, it } from 'vitest';
import { gapCell } from './gap-cell';

/** IB-104 — the venue's gaps never turn the cell into a warning; ours always do. */
describe('gapCell', () => {
  it('only the venue\'s gaps: no warning, a note with the count', () => {
    expect(gapCell({ gapsOpen: 0, gapsVenue: 238 })).toEqual({ ours: 0, warn: false, venueNote: { key: 'health.gapsVenue', params: { count: 238 } } });
  });

  it('one gap of ours among many of the venue\'s: the warning is on', () => {
    const cell = gapCell({ gapsOpen: 1, gapsVenue: 238 });
    expect(cell.warn).toBe(true);
    expect(cell.ours).toBe(1);
  });

  it('no venue gaps, or an answer from before IB-104: no note', () => {
    expect(gapCell({ gapsOpen: 2, gapsVenue: 0 }).venueNote).toBeNull();
    expect(gapCell({ gapsOpen: 2 }).venueNote).toBeNull();
  });
});

import { classifyGap, NEIGHBOUR_SHARE, splitOpen } from '../src/collectors/binance-perp/gap-classifier';

/**
 * IB-104 — whose fault an open OI/LS gap is. The cases are built so a lenient rule (anything with
 * some neighbours is the venue's) or a strict one (everything is ours) fails here.
 */
const BACKFILL = 'not returned by the venue inside its retention window';
const OTHERS = 39; // the box's universe is 40

describe('classifyGap', () => {
  it('every slot had the crypto neighbours stored: the venue did not publish (a closed TradFi session)', () => {
    expect(classifyGap({ error: BACKFILL, minNeighboursStored: 39 }, OTHERS)).toBe('venue');
  });

  it('ONE slot of the window empty across the universe: ours, however full the other slots were', () => {
    // minNeighboursStored is the emptiest slot: a poller outage inside a closed session drags it to 0
    expect(classifyGap({ error: BACKFILL, minNeighboursStored: 0 }, OTHERS)).toBe('ours');
  });

  it('the bar is half of the OTHER symbols, rounded up: exactly at it is the venue, one below is ours', () => {
    const bar = Math.ceil(OTHERS * NEIGHBOUR_SHARE); // 20 of 39
    expect(classifyGap({ error: BACKFILL, minNeighboursStored: bar }, OTHERS)).toBe('venue');
    expect(classifyGap({ error: BACKFILL, minNeighboursStored: bar - 1 }, OTHERS)).toBe('ours');
  });

  it('a row the 5-minute poll wrote because ITS request failed is ours, even with every neighbour stored', () => {
    expect(classifyGap({ error: 'poll failed for 1 symbol(s)', minNeighboursStored: 39 }, OTHERS)).toBe('ours');
  });

  it('"the venue returned no rows for this symbol" is ours: a symbol that stopped working, not a session', () => {
    expect(classifyGap({ error: 'the venue returned no rows for this symbol', minNeighboursStored: 39 }, OTHERS)).toBe('ours');
  });

  it('a universe of one has no control to compare with: ours', () => {
    expect(classifyGap({ error: BACKFILL, minNeighboursStored: 0 }, 0)).toBe('ours');
  });

  it('an unknown or missing error text goes by the evidence alone', () => {
    expect(classifyGap({ error: null, minNeighboursStored: 39 }, OTHERS)).toBe('venue');
  });
});

describe('splitOpen', () => {
  it('counts each window once on its side', () => {
    expect(splitOpen([
      { error: BACKFILL, minNeighboursStored: 39 },
      { error: BACKFILL, minNeighboursStored: 39 },
      { error: BACKFILL, minNeighboursStored: 0 },
      { error: 'poll failed for 2 symbol(s)', minNeighboursStored: 39 },
    ], OTHERS)).toEqual({ ours: 2, venue: 2 });
    expect(splitOpen([], OTHERS)).toEqual({ ours: 0, venue: 0 });
  });
});

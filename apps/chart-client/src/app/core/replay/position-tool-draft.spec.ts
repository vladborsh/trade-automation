import { createDraft } from './position-tool-draft';

const base = { id: 't1', precision: 2, anchorTime: 1_000, lastClose: 100 };

describe('createDraft (design §9.1)', () => {
  it('a long at the last close is a market draft: stop 0.5 % below, target 2R above, active', () => {
    expect(createDraft({ ...base, side: 'long', price: 100 })).toEqual({
      tool: { id: 't1', side: 'long', mode: 'market', entry: 100, sl: 99.5, tp: 101, kind: 'draft', active: true, anchorTime: 1_000 },
      hint: undefined,
    });
  });

  it('a long below the last close is a limit; a short above it is a limit (mirrored levels)', () => {
    expect(createDraft({ ...base, side: 'long', price: 98 }).tool).toMatchObject({ mode: 'limit', entry: 98, sl: 97.51, tp: 98.98 });
    expect(createDraft({ ...base, side: 'short', price: 102 }).tool).toMatchObject({ mode: 'limit', entry: 102, sl: 102.51, tp: 100.98 });
  });

  it('a price on the stop-entry side starts the draft at the last close as market, with a hint', () => {
    const r = createDraft({ ...base, side: 'long', price: 103 });
    expect(r.tool).toMatchObject({ mode: 'market', entry: 100 });
    expect(r.hint).toBe('Stop entries are not supported: the long draft starts at the last close.');
    expect(createDraft({ ...base, side: 'short', price: 97 }).tool).toMatchObject({ mode: 'market', entry: 100 });
  });

  it('snaps to the price precision and keeps the stop at least one tick away', () => {
    expect(createDraft({ ...base, side: 'long', price: 99.987, precision: 1 }).tool).toMatchObject({ entry: 100, mode: 'market', sl: 99.5 });
    // 0.5 % of 1 at 0 decimals rounds to 0: the stop is one tick (1) away instead
    expect(createDraft({ ...base, side: 'long', price: 1, lastClose: 1, precision: 0 }).tool).toMatchObject({ entry: 1, sl: 0, tp: 3 });
  });
});

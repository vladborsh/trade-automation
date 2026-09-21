import type { PositionToolState } from '../../features/chart/overlay/position-tool.model';
import { buildPlaceRequest } from './place-check';

const draft = (over: Partial<PositionToolState> = {}): PositionToolState => ({
  id: 't1', side: 'long', mode: 'limit', entry: 99.5, sl: 99, tp: 101, kind: 'draft', active: true, anchorTime: 0, ...over,
});
const CTX = { panelId: 'btc', cursorMs: 1_000, lastClose: 100, riskPct: 1, balance: 10_000 };

describe('buildPlaceRequest (T-023)', () => {
  it('a limit: side, type, limitPrice, sl, tp, riskPct, cursor and panel from the draft and the panel', () => {
    expect(buildPlaceRequest(draft(), CTX)).toEqual({
      input: { kind: 'place', cursorMs: 1_000, panelId: 'btc', side: 'long', type: 'limit', limitPrice: 99.5, sl: 99, tp: 101, riskPct: 1 },
    });
  });

  it('a market order carries no limitPrice; no target means no tp', () => {
    expect(buildPlaceRequest(draft({ mode: 'market', entry: 100, sl: 99.5, tp: null }), { ...CTX, riskPct: 0.5 })).toEqual({
      input: { kind: 'place', cursorMs: 1_000, panelId: 'btc', side: 'long', type: 'market', sl: 99.5, riskPct: 0.5 },
    });
  });

  it("refuses with a hint, in the server's order", () => {
    const hint = (d: Partial<PositionToolState>, ctx: Partial<typeof CTX> = {}) => ('hint' in buildPlaceRequest(draft(d), { ...CTX, ...ctx }) ? (buildPlaceRequest(draft(d), { ...CTX, ...ctx }) as { hint: string }).hint : null);
    expect(hint({}, { riskPct: 101 })).toMatch(/Risk %/);
    expect(hint({ tp: 1e12 })).toMatch(/out of range/);
    expect(hint({}, { lastClose: 99.4 })).toMatch(/no longer below the last close/); // the market moved under the limit
    expect(hint({ sl: 99.49999 })).toMatch(/too close/);
    expect(hint({ mode: 'market', entry: 100, sl: 100.5 })).toMatch(/stop must be below/);
    expect(hint({ tp: 99.4 })).toMatch(/target must be above/);
    expect(hint({}, { balance: 0 })).toMatch(/balance is not positive/);
    expect(hint({ side: 'short', entry: 100.5, sl: 101, tp: 99 })).toBeNull();
  });
});

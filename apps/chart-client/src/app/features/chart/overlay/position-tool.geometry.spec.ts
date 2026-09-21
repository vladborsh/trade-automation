import type { PositionToolState } from './position-tool.model';
import {
  HANDLE_OFFSET_PX,
  applyDrag,
  draggableParts,
  formatQty,
  hitTest,
  labelFor,
  rMultiple,
  snapPrice,
  toolGeometry,
} from './position-tool.geometry';

const draft = (over: Partial<PositionToolState> = {}): PositionToolState => ({
  id: 't1', side: 'long', mode: 'limit', entry: 100, sl: 99.5, tp: 101, kind: 'draft', active: true, anchorTime: 0, ...over,
});
const CTX = { balance: 10_000, riskPct: 1, pricePrecision: 2 };
/** 1 price unit = 10 px, price 100 at y = 500 (y grows downwards). */
const priceToY = (p: number) => 500 - (p - 100) * 10;

describe('position-tool geometry (design §9.1)', () => {
  it('snapPrice, rMultiple, formatQty', () => {
    expect(snapPrice(100.12345, 2)).toBe(100.12);
    expect(rMultiple(draft())).toBe(2);
    expect(rMultiple(draft({ tp: null }))).toBeNull();
    expect(rMultiple(draft({ sl: 100 }))).toBeNull();
    expect(formatQty(200)).toBe('200');
    expect(formatQty(0.0123456)).toBe('0.01235');
  });

  it('labels: entry with qty from positionSize, SL with −1R, TP with its R multiple', () => {
    // 1 % of 10 000 = 100 risked over a 0.5 stop → qty 200
    expect(labelFor(draft(), 'entry', CTX)).toBe('Long limit 100.00 · qty 200');
    expect(labelFor(draft(), 'sl', CTX)).toBe('SL 99.50 · −0.50 · −1R');
    expect(labelFor(draft(), 'tp', CTX)).toBe('TP 101.00 · +1.00 · 2.00R');
    const short = draft({ side: 'short', mode: 'market', sl: 100.5, tp: 99 });
    expect(labelFor(short, 'entry', CTX)).toBe('Short market 100.00 · qty 200');
    expect(labelFor(short, 'sl', CTX)).toBe('SL 100.50 · +0.50 · −1R');
    expect(labelFor(short, 'tp', CTX)).toBe('TP 99.00 · −1.00 · 2.00R');
    expect(labelFor(draft({ tp: null }), 'tp', CTX)).toBe('');
  });

  it('a stop closer than the minimum distance (replay-core isStopTooClose) says so instead of a qty', () => {
    expect(labelFor(draft({ sl: 99.9999 }), 'entry', { ...CTX, pricePrecision: 4 })).toBe('Long limit 100.0000 · stop too close');
    expect(labelFor(draft({ sl: 99.999 }), 'entry', { ...CTX, pricePrecision: 3 })).toMatch(/qty/); // exactly the minimum
    expect(labelFor(draft(), 'entry', { ...CTX, balance: 0 })).toBe('Long limit 100.00 · qty —');
  });

  it('draggable parts: a draft all of them, a live order only stop and target', () => {
    expect(draggableParts(draft())).toEqual(['entry', 'sl', 'tp', 'body']);
    expect(draggableParts(draft({ kind: 'position' }))).toEqual(['sl', 'tp']);
  });

  it('toolGeometry: three handles on a draft, SL/TP only on a position, null off-scale', () => {
    const g = toolGeometry(draft(), 40, priceToY)!;
    expect(g).toMatchObject({ x: 40, yEntry: 500, ySl: 505, yTp: 490 });
    expect(g.handles.map((h) => [h.part, h.x, h.y])).toEqual([
      ['entry', 40 + HANDLE_OFFSET_PX, 500],
      ['sl', 40 + HANDLE_OFFSET_PX, 505],
      ['tp', 40 + HANDLE_OFFSET_PX, 490],
    ]);
    expect(toolGeometry(draft({ kind: 'position' }), 40, priceToY)!.handles.map((h) => h.part)).toEqual(['sl', 'tp']);
    expect(toolGeometry(draft(), 40, () => null)).toBeNull();
  });

  describe('hitTest (6 px tolerance)', () => {
    const a = draft({ id: 'a' });
    const b = draft({ id: 'b', entry: 110, sl: 109, tp: 112, kind: 'position' });
    const geoms = [toolGeometry(a, 40, priceToY)!, toolGeometry(b, 40, priceToY)!];
    const kinds = new Map([['a', 'draft' as const], ['b', 'position' as const]]);
    const hx = 40 + HANDLE_OFFSET_PX;

    it('grabs a handle within 6 px, not at 7', () => {
      expect(hitTest(hx + 6, 505, geoms, kinds)).toEqual({ toolId: 'a', part: 'sl', kind: 'handle' });
      expect(hitTest(hx + 7, 505 + 7, geoms, kinds)).toBeNull();
    });

    it("a draft's entry line grabs the whole tool; a position's entry line only activates", () => {
      expect(hitTest(300, 502, geoms, kinds)).toEqual({ toolId: 'a', part: 'body', kind: 'line' });
      expect(hitTest(300, 400, geoms, kinds)).toEqual({ toolId: 'b', part: 'entry', kind: 'line' }); // price 110
      expect(hitTest(300, 490, geoms, kinds)).toEqual({ toolId: 'a', part: 'tp', kind: 'line' });
    });

    it('a handle beats a line; left of the tool or far from every level is a miss', () => {
      expect(hitTest(hx, 500, geoms, kinds)).toEqual({ toolId: 'a', part: 'entry', kind: 'handle' });
      expect(hitTest(20, 500, geoms, kinds)).toBeNull();
      expect(hitTest(300, 450, geoms, kinds)).toBeNull();
    });
  });

  describe('applyDrag', () => {
    const base = { grabPrice: 0, lastClose: 100.4, precision: 2, marketSnap: 0.02 };

    it('sl/tp follow the pointer (snapped) but stay on their side of the entry', () => {
      expect(applyDrag({ ...base, original: draft(), part: 'sl', price: 99.123 })).toEqual({ tool: draft({ sl: 99.12 }) });
      expect(applyDrag({ ...base, original: draft(), part: 'sl', price: 100.1 })).toEqual({ hint: 'A long stop must stay below the entry.' });
      expect(applyDrag({ ...base, original: draft(), part: 'tp', price: 99.9 })).toEqual({ hint: 'A long target must stay above the entry.' });
      const short = draft({ side: 'short', sl: 100.5, tp: 99 });
      expect(applyDrag({ ...base, original: short, part: 'sl', price: 99.9 })).toEqual({ hint: 'A short stop must stay above the entry.' });
    });

    it('entry: at the last close it is market (snapped onto it), below it a limit, above it refused (stop entry)', () => {
      expect(applyDrag({ ...base, original: draft(), part: 'entry', price: 100.39 })).toEqual({ tool: draft({ entry: 100.4, mode: 'market' }) });
      expect(applyDrag({ ...base, original: draft({ mode: 'market', entry: 100.4 }), part: 'entry', price: 100.2 })).toEqual({ tool: draft({ entry: 100.2, mode: 'limit' }) });
      expect(applyDrag({ ...base, original: draft(), part: 'entry', price: 100.6 })).toEqual({
        hint: 'Stop entries are not supported: a long entry must be at or below the last close.',
      });
      const short = draft({ side: 'short', entry: 100.6, sl: 101, tp: 99.8 });
      expect(applyDrag({ ...base, original: short, part: 'entry', price: 100.3 })).toMatchObject({ hint: expect.stringMatching(/short entry must be at or above/) });
    });

    it('entry cannot cross its stop or target', () => {
      expect(applyDrag({ ...base, original: draft(), part: 'entry', price: 99.4 })).toEqual({ hint: 'The entry cannot cross its stop.' });
      expect(applyDrag({ ...base, lastClose: 102, original: draft(), part: 'entry', price: 101.2 })).toEqual({ hint: 'The entry cannot cross its target.' });
    });

    it('body moves the whole draft by the pointer travel, keeping distances; the same entry rules apply', () => {
      expect(applyDrag({ ...base, original: draft(), part: 'body', grabPrice: 100.05, price: 99.55 })).toEqual({
        tool: draft({ entry: 99.5, sl: 99, tp: 100.5, mode: 'limit' }),
      });
      // dragged up onto the last close → market, sitting exactly on it
      expect(applyDrag({ ...base, original: draft(), part: 'body', grabPrice: 100, price: 100.39 })).toEqual({
        tool: draft({ entry: 100.4, sl: 99.9, tp: 101.4, mode: 'market' }),
      });
      expect(applyDrag({ ...base, original: draft(), part: 'body', grabPrice: 100, price: 101 })).toMatchObject({ hint: expect.stringMatching(/Stop entries/) });
    });

    it('a live order ignores entry/body drags', () => {
      const pos = draft({ kind: 'position' });
      expect(applyDrag({ ...base, original: pos, part: 'body', price: 90 })).toEqual({ tool: pos });
    });
  });
});

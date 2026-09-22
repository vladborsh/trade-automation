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
  showsZones,
  REMOVE_INSET_PX,
  DEFAULT_DRAFT_WIDTH_BARS,
  MIN_LIVE_WIDTH_PX,
  widthBarsAt,
  compactLabel,
  labelPlacement,
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
    // T-054: with the contract the qty is on the venue step, as the order popup sizes it (200 → 150 with a 75-step)
    expect(labelFor(draft(), 'entry', { ...CTX, contract: { unit: 'x', multiplier: 1, minQty: 1, qtyStep: 75, maxLeverage: 10 } })).toBe('Long limit 100.00 · qty 150');
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

  it("a live order's labels show ITS qty and R from its own 1R, not a size from the current balance (T-023)", () => {
    // a long filled at 100.25 (spread paid), qty 0.66666667, 1R = 100: stop 99 → (99 − 100.25) × q / 100 = −0.83R
    const live = draft({ kind: 'position', mode: 'market', entry: 100.25, sl: 99, tp: 103, order: { qty: 0.66666667, riskAmount: 100 } });
    expect(labelFor(live, 'entry', CTX)).toBe('Long position 100.25 · qty 0.6667');
    expect(labelFor(live, 'sl', CTX)).toBe('SL 99.00 · −1.25 · −0.01R');
    expect(labelFor({ ...live, order: { qty: 80, riskAmount: 100 } }, 'sl', CTX)).toBe('SL 99.00 · −1.25 · −1.00R');
    expect(labelFor({ ...live, order: { qty: 80, riskAmount: 100 } }, 'tp', CTX)).toBe('TP 103.00 · +2.75 · +2.20R');
    expect(labelFor(draft({ kind: 'pending', order: { qty: 200, riskAmount: 100 } }), 'entry', CTX)).toBe('Long limit 100.00 · qty 200');
  });

  it('draggable parts: a draft all of them, a live order its stop and target (T-033), a read-only drawing none', () => {
    expect(draggableParts(draft())).toEqual(['entry', 'sl', 'tp', 'body', 'end']); // + its width handle (BUG-018)
    expect(draggableParts(draft({ kind: 'position' }))).toEqual(['sl', 'tp']);
    expect(draggableParts(draft({ kind: 'pending' }))).toEqual(['sl', 'tp']);
    expect(draggableParts(draft({ kind: 'position', readOnly: true }))).toEqual([]);
  });

  it('toolGeometry: three handles on a draft, stop and target on a live order, none read-only, null off-scale', () => {
    const g = toolGeometry(draft(), 40, priceToY)!;
    expect(g).toMatchObject({ x: 40, yEntry: 500, ySl: 505, yTp: 490 });
    expect(g.handles.map((h) => [h.part, h.x, h.y])).toEqual([
      ['entry', 40 + HANDLE_OFFSET_PX, 500],
      ['sl', 40 + HANDLE_OFFSET_PX, 505],
      ['tp', 40 + HANDLE_OFFSET_PX, 490],
    ]);
    expect(toolGeometry(draft({ kind: 'position' }), 40, priceToY)!.handles.map((h) => h.part)).toEqual(['sl', 'tp']);
    expect(toolGeometry(draft({ kind: 'position', readOnly: true }), 40, priceToY)!.handles).toEqual([]);
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

    it("T-033: a position's stop and target are checked against the last close (the server rule), not the entry", () => {
      const pos = draft({ kind: 'position', mode: 'market', entry: 100.25, sl: 99, tp: 110 });
      const at102 = { ...base, lastClose: 102 };
      expect(applyDrag({ ...at102, original: pos, part: 'sl', price: 100.25 })).toEqual({ tool: { ...pos, sl: 100.25 } }); // break-even
      expect(applyDrag({ ...at102, original: pos, part: 'sl', price: 101 })).toEqual({ tool: { ...pos, sl: 101 } }); // trailing in profit
      expect(applyDrag({ ...at102, original: pos, part: 'sl', price: 102.5 })).toEqual({ hint: 'A long stop must stay below the last close.' });
      expect(applyDrag({ ...at102, original: pos, part: 'sl', price: 102 })).toEqual({ hint: 'The stop is too close to the last close.' });
      expect(applyDrag({ ...at102, original: pos, part: 'tp', price: 101.5 })).toEqual({ hint: 'A long target must stay above the last close.' });
      expect(applyDrag({ ...at102, original: pos, part: 'tp', price: 104 })).toEqual({ tool: { ...pos, tp: 104 } });
    });

    it('T-033: a pending order is checked against its limit, as at placement', () => {
      const pending = draft({ kind: 'pending', entry: 99.5, sl: 99, tp: 101 });
      expect(applyDrag({ ...base, original: pending, part: 'sl', price: 99.6 })).toEqual({ hint: 'A long stop must stay below the limit.' });
      expect(applyDrag({ ...base, original: pending, part: 'sl', price: 98.5 })).toEqual({ tool: { ...pending, sl: 98.5 } });
    });

    it('a live order ignores entry/body drags', () => {
      const pos = draft({ kind: 'position' });
      expect(applyDrag({ ...base, original: pos, part: 'body', price: 90 })).toEqual({ tool: pos });
    });
  });
});

describe('showsZones (T-049)', () => {
  it('only a draft shows its risk / reward fill; a pending order and a position are lines only', () => {
    expect(showsZones({ kind: 'draft' })).toBe(true);
    expect(showsZones({ kind: 'pending' })).toBe(false);
    expect(showsZones({ kind: 'position' })).toBe(false);
  });
});

describe('toolGeometry handles near the right edge (T-050)', () => {
  it('a tool anchored a few px from the pane edge keeps its handles inside the pane', () => {
    const t = { id: 't', side: 'long', mode: 'market', entry: 100, sl: 99, tp: 102, kind: 'draft', active: true, anchorTime: 0 } as const;
    const g = toolGeometry({ ...t }, 795, (p) => 1000 - p, 800)!;
    expect(g.x).toBe(795); // the lines still start at the anchor bar
    expect(g.handles.filter((h) => h.part !== 'end').every((h) => h.x === 800 - HANDLE_OFFSET_PX)).toBe(true);
    expect(g.handles.find((h) => h.part === 'end')?.x).toBe(800); // BUG-018: its width handle, on its right edge
    expect(toolGeometry({ ...t }, 300, (p) => 1000 - p, 800)!.handles[0].x).toBe(300 + HANDLE_OFFSET_PX); // room: unchanged
  });
});

describe('the ✕ on a live order’s tool (BUG-017)', () => {
  const live = { id: 'o1', side: 'long', mode: 'market', entry: 100, sl: 99, tp: 102, kind: 'position', active: true, anchorTime: 0, orderId: 'o1' } as const;
  const toY = (p: number) => 1000 - p * 5; // entry 100 → y 500

  it('sits on the entry line near the pane’s right edge — only on a live, editable tool with a known pane', () => {
    expect(toolGeometry({ ...live }, 100, toY, 800)!.remove).toEqual({ x: 800 - REMOVE_INSET_PX, y: 500 });
    expect(toolGeometry({ ...live, kind: 'pending' }, 100, toY, 800)!.remove).not.toBeNull();
    expect(toolGeometry({ ...live, kind: 'draft' }, 100, toY, 800)!.remove).toBeNull();
    expect(toolGeometry({ ...live, readOnly: true }, 100, toY, 800)!.remove).toBeNull();
    expect(toolGeometry({ ...live }, 100, toY)!.remove).toBeNull(); // no pane width: nowhere to put it
  });

  it('a click on it is a remove hit, ahead of the entry line under it', () => {
    const g = toolGeometry({ ...live }, 100, toY, 800)!;
    expect(hitTest(790, 500, [g], new Map([['o1', 'position']]))).toEqual({ toolId: 'o1', part: 'entry', kind: 'remove' });
    expect(hitTest(600, 500, [g], new Map([['o1', 'position']]))).toEqual({ toolId: 'o1', part: 'entry', kind: 'line' });
  });
});

describe('the tool’s right edge (BUG-018)', () => {
  const base = { id: 't', side: 'long', mode: 'market', entry: 100, sl: 99, tp: 102, active: true, anchorTime: 0 } as const;
  const toY = (p: number) => 1000 - p * 5;

  it('a tool ends at its own right edge, clipped to the pane — no longer at the pane’s edge', () => {
    expect(toolGeometry({ ...base, kind: 'draft' }, 100, toY, 800, 220)!.xEnd).toBe(220);
    expect(toolGeometry({ ...base, kind: 'draft' }, 700, toY, 800, 900)!.xEnd).toBe(800); // runs past the pane: painted to it
  });

  it('a live tool is at least MIN_LIVE_WIDTH_PX wide (a just-placed order ends at its own bar)', () => {
    expect(toolGeometry({ ...base, kind: 'pending', orderId: 't' }, 100, toY, 800, 100)!.xEnd).toBe(100 + MIN_LIVE_WIDTH_PX);
  });

  it('its handles, its ✕ and its lines stay within it', () => {
    const g = toolGeometry({ ...base, kind: 'position', orderId: 't' }, 100, toY, 800, 300)!;
    expect(g.remove).toEqual({ x: 300 - REMOVE_INSET_PX, y: 500 });
    const kinds = new Map([['t', 'position' as const]]);
    expect(hitTest(250, 500, [g], kinds)?.kind).toBe('line');
    expect(hitTest(400, 500, [g], kinds)).toBeNull(); // right of the tool: nothing there any more
  });

  it('a draft’s width handle sits on its right edge, while that edge is on screen', () => {
    const on = toolGeometry({ ...base, kind: 'draft' }, 100, toY, 800, 220)!;
    expect(on.handles.find((h) => h.part === 'end')).toEqual({ part: 'end', x: 220, y: 500 });
    expect(toolGeometry({ ...base, kind: 'draft' }, 700, toY, 800, 900)!.handles.some((h) => h.part === 'end')).toBe(false);
    expect(toolGeometry({ ...base, kind: 'pending', orderId: 't' }, 100, toY, 800, 220)!.handles.some((h) => h.part === 'end')).toBe(false);
  });

  it('widthBarsAt: whole bars from the left edge, never under one', () => {
    expect(widthBarsAt(220, 100, 6)).toBe(20);
    expect(widthBarsAt(104, 100, 6)).toBe(1);
    expect(widthBarsAt(40, 100, 6)).toBe(1);
    expect(widthBarsAt(300, 100, 0)).toBe(DEFAULT_DRAFT_WIDTH_BARS);
  });
});

describe('labelPlacement / compactLabel (T-066)', () => {
  const at = (over: Partial<Parameters<typeof labelPlacement>[0]>) =>
    labelPlacement({ textWidth: 200, compactWidth: 48, boxWidth: 48, roomRight: 0, draft: false, ...over });

  it('the full label inside when it fits, else just right of the tool when there is room', () => {
    expect(at({ boxWidth: 300 })).toEqual({ text: 'full', side: 'inside' });
    expect(at({ roomRight: 300 })).toEqual({ text: 'full', side: 'right' });
    expect(at({ boxWidth: 210, roomRight: 300, shift: 18 })).toEqual({ text: 'full', side: 'right' }); // the ✕'s room counts
  });

  it('then the compact one the same way — inside, then right — and only then inside, overhanging', () => {
    expect(at({ boxWidth: 60 })).toEqual({ text: 'compact', side: 'inside' });
    expect(at({ roomRight: 120 })).toEqual({ text: 'compact', side: 'right' }); // a just-placed order, T-063's margin too narrow for the full label
    expect(at({ roomRight: 20 })).toEqual({ text: 'compact', side: 'inside' });
  });

  it('a draft keeps its full label inside, whatever its width', () => {
    expect(at({ draft: true })).toEqual({ text: 'full', side: 'inside' });
  });

  it('a compact label is the level’s price only', () => {
    const t = { entry: 65383.7, sl: 64184, tp: null };
    expect(compactLabel(t, 'entry', 2)).toBe('65383.70');
    expect(compactLabel(t, 'sl', 2)).toBe('64184.00');
    expect(compactLabel(t, 'tp', 2)).toBe('');
  });
});

import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { SeriesAttachedParameter, Time } from 'lightweight-charts';
import type { IChartApi } from 'lightweight-charts';
import { PositionToolPrimitive, anchorVisible, anchorX, toolRightX } from './position-tool.primitive';
import type { PositionToolState, PositionToolsView } from './position-tool.model';

const RISK = '#ef5350';
const REWARD = '#26a69a';

/** A 2D context that records what was filled and stroked (and with which style / alpha). */
function recordingContext() {
  const calls: { op: string; fillStyle?: string; strokeStyle?: string; alpha: number }[] = [];
  const state = { fillStyle: '', strokeStyle: '', globalAlpha: 1 };
  const stack: (typeof state)[] = [];
  const ctx = {
    get fillStyle() { return state.fillStyle; },
    set fillStyle(v: string) { state.fillStyle = v; },
    get strokeStyle() { return state.strokeStyle; },
    set strokeStyle(v: string) { state.strokeStyle = v; },
    get globalAlpha() { return state.globalAlpha; },
    set globalAlpha(v: number) { state.globalAlpha = v; },
    lineWidth: 1, font: '', textAlign: 'left',
    save: () => stack.push({ ...state }),
    restore: () => Object.assign(state, stack.pop()),
    setLineDash: () => undefined, beginPath: () => undefined, moveTo: () => undefined, lineTo: () => undefined,
    stroke: () => calls.push({ op: 'stroke', strokeStyle: state.strokeStyle, alpha: state.globalAlpha }),
    fillRect: () => calls.push({ op: 'fillRect', fillStyle: state.fillStyle, alpha: state.globalAlpha }),
    strokeRect: () => calls.push({ op: 'strokeRect', strokeStyle: state.strokeStyle, alpha: state.globalAlpha }),
    fillText: () => calls.push({ op: 'fillText', fillStyle: state.fillStyle, alpha: state.globalAlpha }),
    measureText: (text: string) => ({ width: text.length * 6 }), // 6 px a character
  };
  return { ctx, calls };
}

function draw(tool: PositionToolState) {
  const primitive = new PositionToolPrimitive();
  const chart = { timeScale: () => ({ timeToCoordinate: () => 100, timeToIndex: () => 0, logicalToCoordinate: () => 100, width: () => 900, options: () => ({ barSpacing: 6 }) }) };
  const series = { priceToCoordinate: (p: number) => 1000 - p * 5 };
  primitive.attached({ chart, series, requestUpdate: () => undefined } as unknown as SeriesAttachedParameter<Time>);
  const view: PositionToolsView = { tools: [tool], balance: 10_000, riskPct: 1, pricePrecision: 2 };
  primitive.setView(view);
  const { ctx, calls } = recordingContext();
  const target = { useMediaCoordinateSpace: (cb: (s: unknown) => void) => cb({ context: ctx, mediaSize: { width: 900, height: 600 } }) };
  primitive.paneViews()[0].renderer()!.draw(target as unknown as CanvasRenderingTarget2D);
  const zones = calls.filter((c) => c.op === 'fillRect' && (c.fillStyle === RISK || c.fillStyle === REWARD));
  const lines = calls.filter((c) => c.op === 'stroke');
  const labels = calls.filter((c) => c.op === 'fillText');
  const handles = calls.filter((c) => c.op === 'strokeRect');
  return { zones, lines, labels, handles };
}

const tool = (over: Partial<PositionToolState>): PositionToolState => ({
  id: 't', side: 'long', mode: 'limit', entry: 100, sl: 98, tp: 104, kind: 'draft', active: true, anchorTime: 0, ...over,
});

describe('PositionToolPrimitive rendering (T-049)', () => {
  it('a draft keeps its red risk and green reward zones, its three lines, labels and handles', () => {
    const d = draw(tool({}));
    expect(d.zones.map((z) => z.fillStyle)).toEqual([RISK, REWARD]);
    expect(d.lines).toHaveLength(3);
    expect(d.labels).toHaveLength(3);
    expect(d.handles).toHaveLength(4); // entry, SL, TP, and its width handle on the right edge (BUG-018)
  });

  it('a pending order: lines, labels and its SL / TP handles — no fill', () => {
    const d = draw(tool({ kind: 'pending', orderId: 'o1', order: { qty: 1, riskAmount: 2 } }));
    expect(d.zones).toEqual([]);
    expect(d.lines).toHaveLength(4); // 3 levels + the ✕ (BUG-017)
    expect(d.labels).toHaveLength(3);
    expect(d.handles).toHaveLength(2);
  });

  it('an open position: lines only as well, inactive or active', () => {
    for (const active of [false, true]) {
      const d = draw(tool({ kind: 'position', active, orderId: 'o1', order: { qty: 1, riskAmount: 2 } }));
      expect(d.zones).toEqual([]);
      expect(d.lines).toHaveLength(4); // 3 levels + the ✕
    }
  });

  it('without a target: two lines, one zone on a draft, none on a live order', () => {
    expect(draw(tool({ tp: null })).zones.map((z) => z.fillStyle)).toEqual([RISK]);
    expect(draw(tool({ tp: null, kind: 'position', orderId: 'o1', order: { qty: 1, riskAmount: 2 } })).zones).toEqual([]);
    expect(draw(tool({ tp: null, kind: 'position', orderId: 'o1', order: { qty: 1, riskAmount: 2 } })).lines).toHaveLength(3); // 2 levels + the ✕
  });
});

describe('the ✕ on a live order’s tool (BUG-017)', () => {
  it('a pending order and an open position get one; a draft and a read-only (view-only) tool do not', () => {
    const live = { orderId: 'o1', order: { qty: 1, riskAmount: 2 } };
    expect(draw(tool({ kind: 'pending', ...live })).lines).toHaveLength(4);
    expect(draw(tool({ kind: 'position', ...live })).lines).toHaveLength(4);
    expect(draw(tool({})).lines).toHaveLength(3);
    expect(draw(tool({ kind: 'position', readOnly: true, ...live })).lines).toHaveLength(3);
  });
});

describe('anchorX / anchorVisible (T-050)', () => {
  const chartAt = (coord: number | null, indexCoord: number | null = null) =>
    ({
      timeScale: () => ({
        timeToCoordinate: () => coord,
        timeToIndex: () => (indexCoord === null ? null : 7),
        logicalToCoordinate: () => indexCoord,
        width: () => 800,
        options: () => ({ barSpacing: 6 }),
      }),
    }) as unknown as IChartApi;

  it('the anchor bar’s own x — not clamped to the right edge (the old 200 px rule) nor to 0', () => {
    expect(anchorX(chartAt(790), 1_000)).toBe(790);
    expect(anchorX(chartAt(-120), 1_000)).toBe(-120); // started before the visible range
    expect(anchorX(chartAt(950), 1_000)).toBe(950); // after it: off-screen right
  });

  it('a time with no bar of its own takes the nearest bar; none at all is null', () => {
    expect(anchorX(chartAt(null, 333), 1_000)).toBe(333);
    expect(anchorX(chartAt(null, null), 1_000)).toBeNull();
  });

  it('visible while it starts inside the pane or left of it', () => {
    expect(anchorVisible(-120, 800)).toBe(true);
    expect(anchorVisible(799, 800)).toBe(true);
    expect(anchorVisible(800, 800)).toBe(false);
    expect(anchorVisible(null, 800)).toBe(false);
  });

  it('a tool starting right of the pane is not painted at all', () => {
    const primitive = new PositionToolPrimitive();
    const chart = chartAt(1_200);
    primitive.attached({ chart, series: { priceToCoordinate: (p: number) => p }, requestUpdate: () => undefined } as unknown as SeriesAttachedParameter<Time>);
    primitive.setView({ tools: [tool({})], balance: 10_000, riskPct: 1, pricePrecision: 2 });
    const { ctx, calls } = recordingContext();
    const target = { useMediaCoordinateSpace: (cb: (s: unknown) => void) => cb({ context: ctx, mediaSize: { width: 900, height: 600 } }) };
    primitive.paneViews()[0].renderer()!.draw(target as unknown as CanvasRenderingTarget2D);
    expect(calls).toEqual([]);
  });
});

describe('toolRightX and the painted right edge (BUG-018)', () => {
  const chart = (coordOf: (t: number) => number | null) =>
    ({ timeScale: () => ({ timeToCoordinate: (t: number) => coordOf(t), timeToIndex: () => null, logicalToCoordinate: () => null, width: () => 900, options: () => ({ barSpacing: 6 }) }) }) as unknown as IChartApi;

  it('a live tool ends at its endTime’s bar; a draft at its width in bars × the bar spacing (20 by default)', () => {
    const c = chart((t) => (t === 2_000 ? 480 : 100));
    expect(toolRightX(c, { endTime: 2_000_000 }, 100)).toBe(480);
    expect(toolRightX(c, {}, 100)).toBe(100 + 20 * 6);
    expect(toolRightX(c, { widthBars: 5 }, 100)).toBe(130);
  });

  it('lines and labels end at the tool’s right edge, not the pane’s', () => {
    const primitive = new PositionToolPrimitive();
    primitive.attached({ chart: chart(() => 100), series: { priceToCoordinate: (p: number) => 1000 - p * 5 }, requestUpdate: () => undefined } as unknown as SeriesAttachedParameter<Time>);
    primitive.setView({ tools: [tool({ widthBars: 10 })], balance: 10_000, riskPct: 1, pricePrecision: 2 }); // 100 → 160
    const xs: number[] = [];
    const texts: number[] = [];
    const { ctx } = recordingContext();
    (ctx as unknown as { lineTo: (x: number) => void }).lineTo = (x: number) => void xs.push(x);
    (ctx as unknown as { fillText: (s: string, x: number) => void }).fillText = (_s: string, x: number) => void texts.push(x);
    const target = { useMediaCoordinateSpace: (cb: (s: unknown) => void) => cb({ context: ctx, mediaSize: { width: 900, height: 600 } }) };
    primitive.paneViews()[0].renderer()!.draw(target as unknown as CanvasRenderingTarget2D);
    expect(new Set(xs)).toEqual(new Set([160])); // every level ray stops at the tool's end
    expect(texts.every((x) => x === 156)).toBe(true); // labels inside the box, at its right end
  });

  it('a tool that ends left of the visible range is not painted', () => {
    const primitive = new PositionToolPrimitive();
    primitive.attached({ chart: chart(() => -500), series: { priceToCoordinate: (p: number) => p }, requestUpdate: () => undefined } as unknown as SeriesAttachedParameter<Time>);
    primitive.setView({ tools: [tool({ widthBars: 10 })], balance: 10_000, riskPct: 1, pricePrecision: 2 }); // −500 → −440
    const { ctx, calls } = recordingContext();
    const target = { useMediaCoordinateSpace: (cb: (s: unknown) => void) => cb({ context: ctx, mediaSize: { width: 900, height: 600 } }) };
    primitive.paneViews()[0].renderer()!.draw(target as unknown as CanvasRenderingTarget2D);
    expect(calls).toEqual([]);
  });
});

describe('labels on a short live tool (T-066)', () => {
  /** Draws one tool and returns every label: its text, x and alignment. */
  function labels(t: PositionToolState, anchor: number, end: number | null, paneWidth = 900) {
    const primitive = new PositionToolPrimitive();
    const chart = {
      timeScale: () => ({
        timeToCoordinate: (sec: number) => (sec === 9 ? end : anchor), // endTime 9 000 ms → second 9
        timeToIndex: () => null, logicalToCoordinate: () => null, width: () => paneWidth, options: () => ({ barSpacing: 6 }),
      }),
    };
    primitive.attached({ chart, series: { priceToCoordinate: (p: number) => 1000 - p * 5 }, requestUpdate: () => undefined } as unknown as SeriesAttachedParameter<Time>);
    primitive.setView({ tools: [t], balance: 10_000, riskPct: 1, pricePrecision: 2 });
    const out: { text: string; x: number; align: string }[] = [];
    const { ctx } = recordingContext();
    (ctx as unknown as { fillText: (s: string, x: number) => void }).fillText = (text: string, x: number) => void out.push({ text, x, align: ctx.textAlign });
    const target = { useMediaCoordinateSpace: (cb: (s: unknown) => void) => cb({ context: ctx, mediaSize: { width: paneWidth, height: 600 } }) };
    primitive.paneViews()[0].renderer()!.draw(target as unknown as CanvasRenderingTarget2D);
    return out;
  }
  const live = (over: Partial<PositionToolState> = {}) =>
    tool({ kind: 'position', orderId: 'o1', order: { qty: 1, riskAmount: 2 }, endTime: 9_000, ...over });

  it('fits inside: a wide live box keeps its labels inside, at its right end', () => {
    const out = labels(live(), 100, 700); // a 600 px box
    expect(out.every((l) => l.align === 'right' && l.x <= 700)).toBe(true);
    expect(out[0].text).toContain('Long position');
  });

  it('outside right: a just-placed order’s labels go just right of its end — into the empty margin', () => {
    const out = labels(live(), 500, 500); // ends at its own bar: the 48 px minimum, 552 px of room right of it
    expect(out.map((l) => [l.align, l.x])).toEqual([['left', 554], ['left', 554], ['left', 554]]);
    expect(out[0].text).toContain('Long position'); // the full label, not a compact one
  });

  it('compact: no room for the full label either way — the price only, just right of the tool when it fits there', () => {
    const out = labels(live(), 780, 780); // 48 px box at 780 → 828; 72 px before the pane's edge
    // the entry's price must also clear the ✕ (18 px): it goes right; the stop's and target's fit inside the 48 px box
    expect(out.map((l) => [l.text, l.align, l.x])).toEqual([['100.00', 'left', 834], ['98.00', 'right', 824], ['104.00', 'right', 824]]);
  });

  it('compact inside, overhanging, only when not even the price fits to the right (not at the newest bar)', () => {
    const out = labels(live(), 830, 830); // 48 px box at 830 → 878; 22 px left
    expect(out.map((l) => l.text)).toEqual(['100.00', '98.00', '104.00']);
    expect(out.every((l) => l.align === 'right')).toBe(true);
  });

  it('a draft is unchanged: inside, full labels, even when narrow', () => {
    const out = labels(tool({ widthBars: 2 }), 820, null); // 12 px wide
    expect(out.every((l) => l.align === 'right')).toBe(true);
    expect(out[0].text).toContain('Long limit');
  });
});

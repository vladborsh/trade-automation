import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { SeriesAttachedParameter, Time } from 'lightweight-charts';
import { PositionToolPrimitive } from './position-tool.primitive';
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
  };
  return { ctx, calls };
}

function draw(tool: PositionToolState) {
  const primitive = new PositionToolPrimitive();
  const chart = { timeScale: () => ({ timeToCoordinate: () => 100, timeToIndex: () => 0, logicalToCoordinate: () => 100, width: () => 900 }) };
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
    expect(d.handles).toHaveLength(3); // entry, SL, TP
  });

  it('a pending order: lines, labels and its SL / TP handles — no fill', () => {
    const d = draw(tool({ kind: 'pending', orderId: 'o1', order: { qty: 1, riskAmount: 2 } }));
    expect(d.zones).toEqual([]);
    expect(d.lines).toHaveLength(3);
    expect(d.labels).toHaveLength(3);
    expect(d.handles).toHaveLength(2);
  });

  it('an open position: lines only as well, inactive or active', () => {
    for (const active of [false, true]) {
      const d = draw(tool({ kind: 'position', active, orderId: 'o1', order: { qty: 1, riskAmount: 2 } }));
      expect(d.zones).toEqual([]);
      expect(d.lines).toHaveLength(3);
    }
  });

  it('without a target: two lines, one zone on a draft, none on a live order', () => {
    expect(draw(tool({ tp: null })).zones.map((z) => z.fillStyle)).toEqual([RISK]);
    expect(draw(tool({ tp: null, kind: 'position', orderId: 'o1', order: { qty: 1, riskAmount: 2 } })).zones).toEqual([]);
    expect(draw(tool({ tp: null, kind: 'position', orderId: 'o1', order: { qty: 1, riskAmount: 2 } })).lines).toHaveLength(2);
  });
});

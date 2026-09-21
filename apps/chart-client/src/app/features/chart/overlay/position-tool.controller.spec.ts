import { vi } from 'vitest';
import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import { HANDLE_OFFSET_PX } from './position-tool.geometry';
import { PositionToolController } from './position-tool.controller';
import type { PositionToolChange, PositionToolState, PositionToolsView } from './position-tool.model';

const tool = (over: Partial<PositionToolState> = {}): PositionToolState => ({
  id: 't1', side: 'long', mode: 'limit', entry: 100, sl: 99.5, tp: 101, kind: 'draft', active: false, anchorTime: 0, ...over,
});

/** 1 price unit = 10 px, price 100 at y = 500; every tool's left edge at x = 40. */
function setup(opts: { tools?: PositionToolState[]; enabled?: boolean; lastClose?: number } = {}) {
  const saved = { handleScroll: true, handleScale: { axisPressedMouseMove: true } };
  const chart = {
    options: vi.fn(() => saved),
    applyOptions: vi.fn(),
    timeScale: () => ({ timeToCoordinate: () => 40, width: () => 800 }),
  };
  const series = {
    priceToCoordinate: (p: number) => 500 - (p - 100) * 10,
    coordinateToPrice: (y: number) => 100 + (500 - y) / 10,
  };
  const view: PositionToolsView = { tools: opts.tools ?? [tool()], balance: 10_000, riskPct: 1, pricePrecision: 2 };
  const changes: PositionToolChange[] = [];
  const el = document.createElement('div');
  el.setPointerCapture = vi.fn();
  el.releasePointerCapture = vi.fn();
  el.hasPointerCapture = vi.fn(() => true);
  const controller = new PositionToolController({
    chart: () => chart as unknown as IChartApi,
    series: () => series as unknown as ISeriesApi<SeriesType>,
    view: () => view,
    enabled: () => opts.enabled ?? true,
    lastClose: () => opts.lastClose ?? 100.4,
    emit: (c) => changes.push(c),
  });
  controller.attach(el);
  const fire = (type: string, x: number, y: number, pointerId = 1) => {
    const e = new Event(type, { bubbles: true, cancelable: true }) as Event & { clientX: number; clientY: number; pointerId: number };
    Object.assign(e, { clientX: x, clientY: y, pointerId });
    const stop = vi.spyOn(e, 'stopPropagation');
    el.dispatchEvent(e);
    return { stopped: stop.mock.calls.length > 0, defaultPrevented: e.defaultPrevented };
  };
  return { controller, chart, el, changes, fire, saved };
}

const HX = 40 + HANDLE_OFFSET_PX;

describe('PositionToolController (design §9.1)', () => {
  it('a handle hit activates the tool and starts a drag: scroll/scale off, pointer captured, the event kept from the chart', () => {
    const { controller, chart, el, changes, fire } = setup();
    const down = fire('pointerdown', HX + 3, 505); // SL handle (price 99.5) within 6 px
    expect(changes).toEqual([{ type: 'activate', id: 't1' }]);
    expect(chart.applyOptions).toHaveBeenCalledWith({ handleScroll: false, handleScale: false });
    expect(el.setPointerCapture).toHaveBeenCalledWith(1);
    expect(controller.dragging).toBe(true);
    expect(down).toEqual({ stopped: true, defaultPrevented: true });
  });

  it('move updates the grabbed level (snapped); pointerup restores the saved options, releases capture, emits final', () => {
    const { controller, chart, el, changes, fire, saved } = setup();
    fire('pointerdown', HX, 505);
    fire('pointermove', HX, 512.3); // price 98.77
    expect(changes.at(-1)).toEqual({ type: 'update', tool: tool({ sl: 98.77 }), final: false });
    fire('pointerup', HX, 512.3);
    expect(chart.applyOptions).toHaveBeenLastCalledWith(saved);
    expect(el.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(changes.at(-1)).toEqual({ type: 'update', tool: tool({ sl: 98.77 }), final: true });
    expect(controller.dragging).toBe(false);
  });

  it('restores the real options even though the chart merges applyOptions into its live options object', () => {
    const { chart, fire } = setup();
    const live = { handleScroll: { mouseWheel: true, pressedMouseMove: true }, handleScale: { axisPressedMouseMove: true } };
    chart.options.mockImplementation(() => live as never);
    chart.applyOptions.mockImplementation((o: { handleScroll: unknown; handleScale: unknown }) => {
      // lightweight-charts merges in place: `false` turns every flag of the nested object off
      for (const key of ['handleScroll', 'handleScale'] as const) {
        const value = o[key];
        const target = live[key] as Record<string, boolean>;
        for (const flag of Object.keys(target)) target[flag] = typeof value === 'boolean' ? value : (value as Record<string, boolean>)[flag];
      }
    });
    fire('pointerdown', HX, 505);
    expect(live.handleScroll.pressedMouseMove).toBe(false); // disabled during the drag
    fire('pointerup', HX, 505);
    expect(live).toEqual({ handleScroll: { mouseWheel: true, pressedMouseMove: true }, handleScale: { axisPressedMouseMove: true } });
  });

  it('pointercancel restores just the same', () => {
    const { controller, chart, el, fire, saved } = setup();
    fire('pointerdown', HX, 505);
    fire('pointercancel', HX, 505);
    expect(chart.applyOptions).toHaveBeenLastCalledWith(saved);
    expect(el.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(controller.dragging).toBe(false);
  });

  it('a miss does nothing: no event, no option change, the chart gets the pointer (it pans)', () => {
    const { chart, changes, fire } = setup();
    expect(fire('pointerdown', 300, 300)).toEqual({ stopped: false, defaultPrevented: false });
    expect(changes).toEqual([]);
    expect(chart.applyOptions).not.toHaveBeenCalled();
  });

  it('disabled: pointerdown on a handle does nothing', () => {
    const { chart, changes, fire } = setup({ enabled: false });
    fire('pointerdown', HX, 505);
    expect(changes).toEqual([]);
    expect(chart.applyOptions).not.toHaveBeenCalled();
  });

  it("dragging a long draft's entry above the last close is refused with a hint; the state stays", () => {
    const { changes, fire } = setup();
    fire('pointerdown', HX, 500); // entry handle
    fire('pointermove', HX, 485); // price 101.5: past the last close 100.4 and outside its 4 px (0.4) snap zone
    expect(changes.at(-1)).toEqual({ type: 'hint', message: expect.stringMatching(/Stop entries are not supported/) });
    fire('pointerup', HX, 485);
    expect(changes.at(-1)).toEqual({ type: 'update', tool: tool(), final: true });
  });

  it('dragging the entry to the last close flips to market; the whole draft moves by its entry line', () => {
    const { changes, fire } = setup();
    fire('pointerdown', HX, 500);
    fire('pointermove', HX, 496.1); // 100.39, within 4 px of 100.4
    expect(changes.at(-1)).toMatchObject({ type: 'update', tool: { entry: 100.4, mode: 'market' } });
    fire('pointerup', HX, 496.1);

    const body = setup();
    body.fire('pointerdown', 300, 500); // the entry line, away from the handles: whole tool
    body.fire('pointermove', 300, 510); // −1.0
    expect(body.changes.at(-1)).toEqual({ type: 'update', tool: tool({ entry: 99, sl: 98.5, tp: 100 }), final: false });
  });

  it("a live order's entry line only activates it (no drag); another pointer's moves are ignored", () => {
    const { controller, chart, changes, fire } = setup({ tools: [tool({ kind: 'position' })] });
    fire('pointerdown', 300, 500);
    expect(changes).toEqual([{ type: 'activate', id: 't1' }]);
    expect(controller.dragging).toBe(false);
    expect(chart.applyOptions).not.toHaveBeenCalled();

    const other = setup();
    other.fire('pointerdown', HX, 505, 1);
    other.fire('pointermove', HX, 520, 2);
    expect(other.changes).toHaveLength(1);
  });

  it('hover: a resize cursor over a stop handle, move over a draft entry line, nothing on a miss', () => {
    const { el, fire, changes } = setup();
    fire('pointermove', HX, 505);
    expect([el.style.cursor, el.dataset['positionToolHover']]).toEqual(['ns-resize', 'handle:sl:t1']);
    fire('pointermove', 300, 500);
    expect([el.style.cursor, el.dataset['positionToolHover']]).toEqual(['move', 'line:body:t1']);
    fire('pointermove', 300, 300);
    expect([el.style.cursor, el.dataset['positionToolHover']]).toEqual(['', undefined]);
    expect(changes).toEqual([]);
  });

  it('a tool anchored at the right edge is drawn at least 200 px wide, so its handles stay reachable', () => {
    const edge = setup();
    (edge.chart as unknown as { timeScale: () => unknown }).timeScale = () => ({ timeToCoordinate: () => 790, width: () => 800 });
    edge.fire('pointerdown', 600 + HANDLE_OFFSET_PX, 505); // left edge clamped to 800 − 200 = 600
    expect(edge.changes).toEqual([{ type: 'activate', id: 't1' }]);
  });

  it('detach removes every listener', () => {
    const { controller, changes, fire } = setup();
    controller.detach();
    fire('pointerdown', HX, 505);
    expect(changes).toEqual([]);
  });
});

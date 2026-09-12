import { vi } from 'vitest';
import { ShapesPrimitive } from './shapes.primitive';

/**
 * Renderer test per architecture/vwap-band-reversal-plugin.md §8.2 step 5:
 * asserts a `rect` and a two-point `line` actually produce draw calls. A
 * mock canvas/context stands in for the real lightweight-charts canvas —
 * the primitive's `attached()`/`paneViews()` surface is public API, so no
 * internals need to be reached into.
 */
function makeMockContext() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    setLineDash: vi.fn(),
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
  };
}

function makeTarget(context: ReturnType<typeof makeMockContext>) {
  return {
    useMediaCoordinateSpace: (fn: (scope: { context: unknown; mediaSize: { width: number; height: number } }) => void) =>
      fn({ context, mediaSize: { width: 800, height: 400 } }),
  };
}

function attachPrimitive(primitive: ShapesPrimitive): void {
  const fakeChart = {
    timeScale: () => ({
      timeToCoordinate: (t: number) => t, // identity: t is already the primitive's UTCTimestamp (seconds)
    }),
  };
  const fakeSeries = {
    priceToCoordinate: (p: number) => p,
  };
  primitive.attached({
    chart: fakeChart,
    series: fakeSeries,
    requestUpdate: () => {},
  } as never);
}

describe('ShapesPrimitive', () => {
  it('draws a filled rect for a rect shape', () => {
    const primitive = new ShapesPrimitive();
    attachPrimitive(primitive);
    primitive.setRects([{ from: 1000, to: 5000, top: 110, bottom: 100, color: '#d29922', label: 'iFVG' }]);

    const context = makeMockContext();
    const renderer = primitive.paneViews()[0]!.renderer()!;
    renderer.draw(makeTarget(context) as never);

    expect(context.fillRect).toHaveBeenCalledTimes(1);
    expect(context.fillText).toHaveBeenCalledWith('iFVG', expect.any(Number), expect.any(Number));
  });

  it('draws a polyline through a two-point line shape', () => {
    const primitive = new ShapesPrimitive();
    attachPrimitive(primitive);
    primitive.setLines([
      {
        points: [
          { time: 1000, price: 100 },
          { time: 2000, price: 105 },
        ],
        color: '#26a69a',
        style: 'dashed',
      },
    ]);

    const context = makeMockContext();
    const renderer = primitive.paneViews()[0]!.renderer()!;
    renderer.draw(makeTarget(context) as never);

    expect(context.beginPath).toHaveBeenCalled();
    expect(context.moveTo).toHaveBeenCalledWith(1, 100); // time (ms) -> primitive's msToTime (s) -> fake timeToCoordinate (/1000)
    expect(context.lineTo).toHaveBeenCalledWith(2, 105);
    expect(context.stroke).toHaveBeenCalled();
    expect(context.setLineDash).toHaveBeenCalledWith([4, 3]);
  });

  it('draws nothing when there are no shapes', () => {
    const primitive = new ShapesPrimitive();
    attachPrimitive(primitive);

    const context = makeMockContext();
    const renderer = primitive.paneViews()[0]!.renderer()!;
    renderer.draw(makeTarget(context) as never);

    expect(context.fillRect).not.toHaveBeenCalled();
    expect(context.stroke).not.toHaveBeenCalled();
  });
});

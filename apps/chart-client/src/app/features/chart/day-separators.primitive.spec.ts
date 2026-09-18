import { vi } from 'vitest';
import type { IPaneApi, Time } from 'lightweight-charts';
import { DaySeparatorsPrimitive } from './day-separators.primitive';

const sec = (iso: string): number => Date.parse(iso) / 1000;
const hourly = (startIso: string, count: number): number[] => Array.from({ length: count }, (_, i) => sec(startIso) + i * 3600);

function setup() {
  const primitive = new DaySeparatorsPrimitive();
  const pane = { attachPrimitive: vi.fn(), detachPrimitive: vi.fn() };
  primitive.attachTo(pane as unknown as IPaneApi<Time>);
  const requestUpdate = vi.fn();
  primitive.attached({
    chart: { timeScale: () => ({ logicalToCoordinate: (l: number) => l * 10 }) },
    requestUpdate,
  } as never);
  const context = { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), setLineDash: vi.fn(), globalAlpha: 1, strokeStyle: '', lineWidth: 1 };
  const draw = () =>
    primitive
      .paneViews()[0]
      .renderer()!
      .draw({
        useBitmapCoordinateSpace: (fn: (s: unknown) => void) =>
          fn({ context, bitmapSize: { width: 1000, height: 400 }, horizontalPixelRatio: 1 }),
      } as never);
  return { primitive, pane, requestUpdate, context, draw };
}

describe('DaySeparatorsPrimitive (§12.3)', () => {
  it('attaches to the pane and draws one line per NY day boundary at logical i − 0.5', () => {
    const { primitive, pane, requestUpdate, context, draw } = setup();
    expect(pane.attachPrimitive).toHaveBeenCalledWith(primitive);
    primitive.setData(hourly('2026-07-15T00:00:00Z', 20), '1h'); // boundary at index 4 (04:00Z)
    expect(requestUpdate).toHaveBeenCalled();
    draw();
    expect(context.moveTo).toHaveBeenCalledTimes(1);
    expect(context.moveTo).toHaveBeenCalledWith(35.5, 0); // (4 − 0.5) × 10 px, pixel-centred
    expect(primitive.hitTest()).toBeNull();
  });

  it('draws nothing on 4h / 1d', () => {
    const { primitive, context, draw } = setup();
    primitive.setData(hourly('2026-07-15T00:00:00Z', 30), '4h');
    draw();
    primitive.setData(hourly('2026-07-15T00:00:00Z', 30), '1d');
    draw();
    expect(context.moveTo).not.toHaveBeenCalled();
  });

  it('detaches from its pane', () => {
    const { primitive, pane } = setup();
    primitive.detach();
    expect(pane.detachPrimitive).toHaveBeenCalledWith(primitive);
  });
});

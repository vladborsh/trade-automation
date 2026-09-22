import { vi } from 'vitest';
import { CaptureSlot, SCREENSHOT_MAX_WIDTH_PX, captureChart, downscaledSize } from './capture-chart';

/** A canvas stand-in: jsdom has no 2D context or PNG encoder. */
function fakeCanvas(width = 0, height = 0) {
  const drawImage = vi.fn();
  const canvas = {
    width,
    height,
    getContext: vi.fn(() => ({ drawImage })),
    toBlob: vi.fn((cb: (b: Blob | null) => void, type: string) => cb(new Blob(['png'], { type }))),
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, drawImage, raw: canvas };
}

describe('downscaledSize (§9.2: at most 1280 px wide, keeping the aspect)', () => {
  it('a wider picture comes down to exactly the bound, the height in proportion', () => {
    expect(downscaledSize(2560, 1440)).toEqual({ width: 1280, height: 720 }); // a 2× retina chart
    expect(downscaledSize(1917, 814)).toEqual({ width: 1280, height: 544 }); // 814 × 1280 / 1917 = 543.5 → 544
  });

  it('never upscales: at or below the bound the size is kept', () => {
    expect(downscaledSize(1280, 700)).toEqual({ width: 1280, height: 700 });
    expect(downscaledSize(958, 407)).toEqual({ width: 958, height: 407 });
  });

  it('is never wider than the bound nor zero tall, whatever the input', () => {
    for (const [w, h] of [[1281, 1], [100_000, 3], [4096, 2160], [1281, 1281]]) {
      const size = downscaledSize(w, h);
      expect(size.width).toBeLessThanOrEqual(SCREENSHOT_MAX_WIDTH_PX);
      expect(size.height).toBeGreaterThanOrEqual(1);
    }
  });

  it('takes another bound', () => {
    expect(downscaledSize(800, 400, 400)).toEqual({ width: 400, height: 200 });
  });
});

describe('captureChart', () => {
  it('draws the chart onto an offscreen canvas at the bounded size and encodes a PNG', async () => {
    const source = fakeCanvas(2560, 1440);
    const out = fakeCanvas();
    const png = captureChart(() => source.canvas, () => out.canvas);
    expect(out.drawImage).toHaveBeenCalledWith(source.canvas, 0, 0, 1280, 720); // synchronous: the pixels of now
    expect([out.raw.width, out.raw.height]).toEqual([1280, 720]);
    const blob = await png!;
    expect(blob.type).toBe('image/png');
    expect(out.raw.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
  });

  it('is null without a chart (a collapsed panel) or with an empty one', () => {
    expect(captureChart(() => null, () => fakeCanvas().canvas)).toBeNull();
    expect(captureChart(() => fakeCanvas(0, 300).canvas, () => fakeCanvas().canvas)).toBeNull();
  });

  it('rejects when the encoder gives nothing', async () => {
    const out = fakeCanvas();
    out.raw.toBlob.mockImplementation((cb: (b: Blob | null) => void) => cb(null));
    await expect(captureChart(() => fakeCanvas(10, 10).canvas, () => out.canvas)).rejects.toThrow(/PNG/);
  });
});

describe('CaptureSlot', () => {
  it('takes through whatever the chart panel attached, and nothing once detached', () => {
    const slot = new CaptureSlot();
    expect(slot.take()).toBeNull();
    const canvas = fakeCanvas(10, 10).canvas;
    slot.attach(() => canvas);
    expect(slot.take()).toBe(canvas);
    slot.attach(null);
    expect(slot.take()).toBeNull();
  });
});

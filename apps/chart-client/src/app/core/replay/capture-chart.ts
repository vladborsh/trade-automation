import type { PanelCapture } from '../../features/panel-grid/panel-source';

/** The server's default `SCREENSHOT_MAX_WIDTH_PX` (T-025): wider PNGs are refused with a 400. */
export const SCREENSHOT_MAX_WIDTH_PX = 1280;

/** A chart's picture as `IChartApi.takeScreenshot` returns it, or null when there is no chart. */
export type TakeScreenshot = () => HTMLCanvasElement | null;

/** At most `maxWidth` wide, keeping the aspect; never upscaled; at least 1 px tall. */
export function downscaledSize(width: number, height: number, maxWidth = SCREENSHOT_MAX_WIDTH_PX): { width: number; height: number } {
  if (width <= maxWidth) return { width, height };
  return { width: maxWidth, height: Math.max(1, Math.round((height * maxWidth) / width)) };
}

/**
 * backtest-app-system-design.md §9.2 — a chart's picture as a PNG at most `maxWidth` wide. The
 * pixels are taken and drawn onto an offscreen canvas **synchronously** (the picture is of this
 * moment, e.g. the Enter keypress); only the PNG encoding is asynchronous. Null when there is no
 * chart to take (a collapsed panel, a chart not created yet).
 */
export function captureChart(
  take: TakeScreenshot,
  createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
  maxWidth = SCREENSHOT_MAX_WIDTH_PX,
): Promise<Blob> | null {
  const source = take();
  if (!source || source.width === 0 || source.height === 0) return null;
  const size = downscaledSize(source.width, source.height, maxWidth);
  const out = createCanvas();
  out.width = size.width;
  out.height = size.height;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, size.width, size.height);
  return new Promise((resolve, reject) =>
    out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The chart picture could not be encoded as PNG.'))), 'image/png'),
  );
}

/**
 * The replay source's end of `PanelSource.capture`: the chart panel attaches its chart's
 * `takeScreenshot` while the chart exists; the workspace takes a picture through it.
 */
export class CaptureSlot implements PanelCapture {
  private fn: TakeScreenshot | null = null;

  attach(take: TakeScreenshot | null): void {
    this.fn = take;
  }

  take(): HTMLCanvasElement | null {
    return this.fn?.() ?? null;
  }
}

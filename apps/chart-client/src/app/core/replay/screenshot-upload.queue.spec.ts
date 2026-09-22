import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ApiError } from '../api/api-error';
import { BacktestClient } from '../api/backtest.client';
import { MAX_UPLOAD_ATTEMPTS, ScreenshotUploadQueue, type ScreenshotJob } from './screenshot-upload.queue';

const flush = () => new Promise((r) => setTimeout(r, 0));
const png = new Blob(['png'], { type: 'image/png' });
const job = (orderId: string, kind: 'entry' | 'exit' = 'entry', p: Promise<Blob> = Promise.resolve(png)): ScreenshotJob => ({
  sessionId: 's1',
  orderId,
  kind,
  png: p,
});

function setup() {
  const uploadScreenshot = vi.fn();
  TestBed.configureTestingModule({ providers: [{ provide: BacktestClient, useValue: { uploadScreenshot } }] });
  const queue = TestBed.inject(ScreenshotUploadQueue);
  const delays: number[] = [];
  queue.delay = async (ms) => void delays.push(ms);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  return { queue, uploadScreenshot, delays };
}

describe('ScreenshotUploadQueue (§9.2)', () => {
  it('uploads the PNG for the order and kind, and reports it pending, then uploaded', async () => {
    const { queue, uploadScreenshot } = setup();
    let answer!: () => void;
    uploadScreenshot.mockReturnValue(new Promise<void>((r) => (answer = r)));
    queue.enqueue(job('o1', 'exit'));
    await flush();
    expect(uploadScreenshot).toHaveBeenCalledWith('s1', 'o1', 'exit', png);
    expect([...queue.pending()]).toEqual(['o1:exit']);
    answer();
    await flush();
    expect([...queue.pending()]).toEqual([]);
    expect([...queue.uploaded()]).toEqual(['o1:exit']);
  });

  it('retries a network failure and a 5xx with the capped backoff, then succeeds', async () => {
    const { queue, uploadScreenshot, delays } = setup();
    uploadScreenshot
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new ApiError(503, null, 'unavailable'))
      .mockRejectedValueOnce(new ApiError(500, null, 'Could not store the screenshot. Try again.'))
      .mockResolvedValueOnce({});
    queue.enqueue(job('o1'));
    await vi.waitFor(() => expect(queue.uploaded().has('o1:entry')).toBe(true));
    expect(uploadScreenshot).toHaveBeenCalledTimes(4);
    expect(delays).toEqual([250, 500, 1000]);
  });

  it('a 409 SCREENSHOT_EXISTS is success: write-once, an earlier attempt landed', async () => {
    const { queue, uploadScreenshot } = setup();
    uploadScreenshot.mockRejectedValueOnce(new ApiError(409, 'SCREENSHOT_EXISTS', 'exists'));
    queue.enqueue(job('o1'));
    await vi.waitFor(() => expect(queue.uploaded().has('o1:entry')).toBe(true));
    expect(uploadScreenshot).toHaveBeenCalledTimes(1);
  });

  it('any other 4xx is final: no retry, not uploaded, logged', async () => {
    const { queue, uploadScreenshot, delays } = setup();
    uploadScreenshot.mockRejectedValue(new ApiError(404, null, 'gone'));
    queue.enqueue(job('o1'));
    await vi.waitFor(() => expect(queue.pending().size).toBe(0));
    expect(uploadScreenshot).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
    expect(queue.uploaded().size).toBe(0);
    expect(console.warn).toHaveBeenCalled();
  });

  it('gives up after MAX_UPLOAD_ATTEMPTS network failures', async () => {
    const { queue, uploadScreenshot } = setup();
    uploadScreenshot.mockRejectedValue(new TypeError('Failed to fetch'));
    queue.enqueue(job('o1'));
    await vi.waitFor(() => expect(queue.pending().size).toBe(0));
    expect(uploadScreenshot).toHaveBeenCalledTimes(MAX_UPLOAD_ATTEMPTS);
    expect(queue.uploaded().size).toBe(0);
  });

  it('jobs run independently: one backing off does not hold up the next', async () => {
    const { queue, uploadScreenshot } = setup();
    let release!: () => void;
    queue.delay = () => new Promise<void>((r) => (release = r)); // o1's backoff never ends until released
    uploadScreenshot.mockImplementation(async (_s: string, orderId: string) => {
      if (orderId === 'o1' && uploadScreenshot.mock.calls.filter((c) => c[1] === 'o1').length === 1) throw new TypeError('Failed to fetch');
    });
    queue.enqueue(job('o1'));
    queue.enqueue(job('o2', 'exit'));
    await vi.waitFor(() => expect(queue.uploaded().has('o2:exit')).toBe(true));
    expect(queue.pending().has('o1:entry')).toBe(true);
    release();
    await vi.waitFor(() => expect(queue.uploaded().has('o1:entry')).toBe(true));
  });

  it('the same order and kind is queued once', async () => {
    const { queue, uploadScreenshot } = setup();
    uploadScreenshot.mockResolvedValue({});
    queue.enqueue(job('o1'));
    queue.enqueue(job('o1'));
    await vi.waitFor(() => expect(queue.uploaded().has('o1:entry')).toBe(true));
    queue.enqueue(job('o1'));
    await flush();
    expect(uploadScreenshot).toHaveBeenCalledTimes(1);
  });

  it('a picture that failed to encode is dropped, logged, never sent', async () => {
    const { queue, uploadScreenshot } = setup();
    queue.enqueue(job('o1', 'entry', Promise.reject(new Error('no PNG'))));
    await vi.waitFor(() => expect(queue.pending().size).toBe(0));
    expect(uploadScreenshot).not.toHaveBeenCalled();
  });
});

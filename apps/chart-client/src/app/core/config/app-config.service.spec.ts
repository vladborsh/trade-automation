import { vi } from 'vitest';
import { AppConfigService } from './app-config.service';

describe('AppConfigService.load', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches config.json once however often it is asked (app initializer + LayoutFeedService)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ apiBaseUrl: '/api', wsUrl: 'ws://x' })));
    vi.stubGlobal('fetch', fetchMock);
    const config = new AppConfigService();

    await Promise.all([config.load(), config.load()]);
    await config.load();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(config.get().apiBaseUrl).toBe('/api');
  });

  it('retries after a failed fetch', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ apiBaseUrl: '/api', wsUrl: 'ws://x' })));
    vi.stubGlobal('fetch', fetchMock);
    const config = new AppConfigService();

    await expect(config.load()).rejects.toThrow('HTTP 503');
    await config.load();
    expect(config.get().wsUrl).toBe('ws://x');
  });
});

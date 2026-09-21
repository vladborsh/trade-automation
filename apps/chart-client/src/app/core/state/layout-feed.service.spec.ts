import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { AppConfigService } from '../config/app-config.service';
import { LiveSocket } from '../api/live.socket';
import { RestClient } from '../api/rest.client';
import { LayoutFeedService } from './layout-feed.service';

describe('LayoutFeedService.boot', () => {
  it('boots once even though /terminal re-creates the shell (and calls boot) on every visit', async () => {
    const rest = { getInstruments: vi.fn().mockResolvedValue([]), getLayouts: vi.fn().mockResolvedValue([]) };
    const socket = {
      connectionState: new Subject(),
      statusFrames$: new Subject(),
      reconnected: new Subject(),
      connect: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: AppConfigService, useValue: { load: () => Promise.resolve(), get: () => ({ apiBaseUrl: '', wsUrl: 'ws://x' }) } },
        { provide: RestClient, useValue: rest },
        { provide: LiveSocket, useValue: socket },
      ],
    });
    const feed = TestBed.inject(LayoutFeedService);

    await feed.boot();
    await feed.boot();
    expect(rest.getLayouts).toHaveBeenCalledTimes(1);
    expect(socket.connect).toHaveBeenCalledTimes(1);
  });
});

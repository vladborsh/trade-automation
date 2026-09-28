import { Injectable } from '@angular/core';

export interface RuntimeConfig {
  apiBaseUrl: string;
  /**
   * IB-030: optional, because this service is now shared with the insight dashboard, whose
   * `config.json` is `{ "apiBaseUrl": "/api/web" }` — it has no websocket. Generalised here rather
   * than forked (insight-bot-web-dashboard.md §3: "if a shared piece turns out to be
   * backtest-specific, it is generalised in place with its own spec"). The one consumer,
   * `LayoutFeedService`, now says out loud that it needs it.
   */
  wsUrl?: string;
}

/**
 * Fetches config.json at boot (§5.4) so one build serves all environments.
 * Loaded once by the app initializer in app.config.ts, before the router's auth guard makes
 * the first API call; later `load()` calls (e.g. LayoutFeedService.boot) reuse that fetch.
 */
@Injectable({ providedIn: 'root' })
export class AppConfigService {
  private config: RuntimeConfig | null = null;
  private loading: Promise<void> | null = null;

  load(): Promise<void> {
    this.loading ??= this.fetchConfig().catch((err: unknown) => {
      this.loading = null; // a failed boot fetch may be retried
      throw err;
    });
    return this.loading;
  }

  private async fetchConfig(): Promise<void> {
    const response = await fetch('/config.json', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to load runtime config.json: HTTP ${response.status}`);
    }
    this.config = (await response.json()) as RuntimeConfig;
  }

  get(): RuntimeConfig {
    if (!this.config) {
      throw new Error('AppConfigService.get() called before load() resolved');
    }
    return this.config;
  }
}

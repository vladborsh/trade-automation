import { Injectable } from '@angular/core';

export interface RuntimeConfig {
  apiBaseUrl: string;
  wsUrl: string;
}

/**
 * Fetches config.json at boot (§5.4) so one build serves all environments.
 * Loaded once via an APP_INITIALIZER before anything else touches the API.
 */
@Injectable({ providedIn: 'root' })
export class AppConfigService {
  private config: RuntimeConfig | null = null;

  async load(): Promise<void> {
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

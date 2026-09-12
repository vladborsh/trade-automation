import { Injectable } from '@angular/core';
import { AppConfigService } from '../config/app-config.service';
import type {
  Candle,
  Health,
  InstrumentId,
  InstrumentWithStatus,
  Signal,
  StrategyInfo,
  Timeframe,
} from '../contracts/contracts';

/**
 * Typed fetchers for the REST surface in §3.5. Plain `fetch`, no RxJS here —
 * RxJS is reserved for the WS boundary (live.socket.ts).
 */
@Injectable({ providedIn: 'root' })
export class RestClient {
  constructor(private readonly config: AppConfigService) {}

  private get baseUrl(): string {
    return this.config.get().apiBaseUrl;
  }

  private async getJson<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(this.baseUrl.replace(/\/$/, '') + path, window.location.origin);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`GET ${path} failed: HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }

  getInstruments(): Promise<InstrumentWithStatus[]> {
    return this.getJson<InstrumentWithStatus[]>('/instruments');
  }

  getCandles(
    instrument: InstrumentId,
    timeframe: Timeframe,
    from?: number,
    to?: number,
    limit = 1500,
  ): Promise<Candle[]> {
    return this.getJson<Candle[]>('/candles', { instrument, timeframe, from, to, limit });
  }

  getSignals(instrument: InstrumentId, from?: number, to?: number, strategyId?: string): Promise<Signal[]> {
    return this.getJson<Signal[]>('/signals', { instrument, from, to, strategyId });
  }

  getStrategies(): Promise<StrategyInfo[]> {
    return this.getJson<StrategyInfo[]>('/strategies');
  }

  getHealth(): Promise<Health> {
    return this.getJson<Health>('/health');
  }
}

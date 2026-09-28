import { Controller, Get } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';
import { MetricsService } from './metrics.service';
import { StreamHealth, StreamRegistry } from './stream-registry';

/** The §6.1 response shape, verbatim. */
export interface HealthResponse {
  streams: StreamHealth[];
  db: { lagSec: number | null };
  budget: { binanceWeightUsed1m: number; binanceSpotWeightUsed1m: number };
  /**
   * IB-006 — universe ids with no `binance_spot` mapping: the spot collector skips them and they
   * have no spot CVD. A fact about the venue, not a fault (§2.3: such features are null, never
   * silently zero), so it is listed rather than reported as a silent stream.
   */
  noSpot: string[];
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly streams: StreamRegistry,
    private readonly metrics: MetricsService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * architecture/insight-bot-system-design.md §6.1 — `{ streams, db: { lagSec }, budget:
   * { binanceWeightUsed1m } }`.
   *
   * At IB-003 `streams` is empty (no collector registers one yet) and `lagSec` is null: the
   * real lag is "now minus the newest market-data row" and those tables land with IB-004, which
   * fills this in. Null means "not measurable", never "zero lag" — the same null-not-zero rule
   * §2.3 states for a missing spot market.
   */
  @Get()
  get(): HealthResponse {
    return {
      streams: this.streams.snapshot(),
      db: { lagSec: null },
      budget: {
        binanceWeightUsed1m: this.metrics.getBinanceWeightUsed1m(),
        binanceSpotWeightUsed1m: this.metrics.getBinanceSpotWeightUsed1m(),
      },
      noSpot: this.config.symbols.filter((s) => !s.binance_spot).map((s) => s.id),
    };
  }
}

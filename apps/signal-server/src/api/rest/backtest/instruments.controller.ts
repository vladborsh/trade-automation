import { Controller, Get, Inject } from '@nestjs/common';
import { BacktestInstrumentsResponse } from '@trade-automation/contracts';
import { AppConfigService } from '../../../config/config.service';
import { CANDLE_STORE, CandleStore } from '../../../storage/candle-store.port';

/**
 * backtest-app-system-design.md §7.2 — GET /api/backtest/instruments. Every configured
 * instrument with its 1m coverage from the candle store (null when nothing is stored), so the
 * create-session form offers only what is actually held (brief decisions 16, 5b).
 * Authenticated: deliberately not `@Public()` — the global AuthGuard (§7.1) covers it.
 */
@Controller('api/backtest/instruments')
export class BacktestInstrumentsController {
  constructor(
    private readonly config: AppConfigService,
    @Inject(CANDLE_STORE) private readonly store: CandleStore,
  ) {}

  @Get()
  async list(): Promise<BacktestInstrumentsResponse> {
    return Promise.all(
      this.config.instruments.map(async (instrument) => ({
        id: instrument.id,
        displayName: instrument.displayName,
        assetClass: instrument.assetClass,
        pricePrecision: instrument.pricePrecision,
        sessionCurrency: instrument.sessionCurrency,
        coverage: await this.store.coverage(instrument.id, '1m'),
        contract: instrument.contract ?? null, // D12 (T-035); refusing an instrument without one is T-053's
      })),
    );
  }
}

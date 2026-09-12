import { Controller, Get } from '@nestjs/common';
import { InstrumentsResponse } from '@trade-automation/contracts';
import { AppConfigService } from '../../config/config.service';
import { MarketDataStatusService } from '../../market-data/market-data-status.service';

/** architecture/live-signal-server.md §3.5 — GET /api/instruments. */
@Controller('api/instruments')
export class InstrumentsController {
  constructor(
    private readonly config: AppConfigService,
    private readonly status: MarketDataStatusService,
  ) {}

  @Get()
  list(): InstrumentsResponse {
    return this.config.instruments.map((instrument) => ({
      ...instrument,
      venueStatus: this.status.get(instrument.id).venueStatus,
    }));
  }
}

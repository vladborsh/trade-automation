import { Controller, Get, Inject, Query, UsePipes } from '@nestjs/common';
import { SignalsQuerySchema, SignalsResponse } from '@trade-automation/contracts';
import { SIGNAL_STORE, SignalStore } from '../../storage/signal-store.port';
import { ZodValidationPipe } from '../zod-validation.pipe';

/** architecture/live-signal-server.md §3.5 — GET /api/signals. */
@Controller('api/signals')
export class SignalsController {
  constructor(@Inject(SIGNAL_STORE) private readonly store: SignalStore) {}

  @Get()
  @UsePipes(new ZodValidationPipe(SignalsQuerySchema))
  async get(@Query() query: ReturnType<typeof SignalsQuerySchema.parse>): Promise<SignalsResponse> {
    return this.store.query(query.instrument, query.from, query.to, query.strategyId);
  }
}

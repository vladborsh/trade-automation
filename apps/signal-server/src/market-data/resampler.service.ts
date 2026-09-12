import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Candle } from '@trade-automation/contracts';
import { Resampler } from './resampler';
import { CandleCache } from './candle-cache.service';
import { CandleClosedEvent, CandleFormingEvent, MarketDataEvents } from './market-data.events';

/** Nest wrapper around the pure `Resampler`: closed 1m -> derived-timeframe closed/forming candles. */
@Injectable()
export class ResamplerService {
  private readonly logger = new Logger(ResamplerService.name);
  private readonly resampler = new Resampler();

  constructor(
    private readonly events: EventEmitter2,
    private readonly cache: CandleCache,
  ) {}

  @OnEvent(MarketDataEvents.CandleClosed)
  handleClosed1m(event: CandleClosedEvent): void {
    const candle = event.candle;
    if (candle.timeframe !== '1m') return;

    const { closed, forming } = this.resampler.onClosed1m(candle);

    for (const c of closed) {
      this.cache.upsert(c);
      this.events.emit(MarketDataEvents.CandleClosed, new CandleClosedEvent(c));
      this.logger.debug(`Closed derived candle ${c.instrument} ${c.timeframe}@${c.openTime}`);
    }
    for (const c of forming) {
      this.events.emit(MarketDataEvents.CandleForming, new CandleFormingEvent(c));
    }
  }

  /** Exposed for tests that want the pure resampling result without the event bus. */
  feed(candle: Candle) {
    return this.resampler.onClosed1m(candle);
  }
}

import { HealthResponseSchema, Instrument, InstrumentId } from '@trade-automation/contracts';
import { HealthController } from '../../src/observability/health.controller';
import { MarketDataStatusService } from '../../src/market-data/market-data-status.service';

/**
 * BUG-021 — the other half of the fix. The adapter now reports `degraded`, but `/api/health` read
 * only the age of the last stored bar, so a venue failing every poll with a recent last bar still
 * came out `ok`: exactly the Capital.com case (a rejected key, T-061). The payload now carries each
 * instrument's `venueStatus`, and a `degraded` venue makes the server `degraded`.
 */
const instruments: Instrument[] = [
  {
    id: 'capitalcom:US100', venue: 'capitalcom', symbol: 'US100', assetClass: 'index-cfd',
    displayName: 'US100', pricePrecision: 1, quoteCurrency: 'USD', sessionCurrency: 'USD', sessionTimezone: 'UTC',
  } as Instrument,
  {
    id: 'binance:BTCUSDT', venue: 'binance', symbol: 'BTCUSDT', assetClass: 'crypto-perp',
    displayName: 'BTC', pricePrecision: 2, quoteCurrency: 'USDT', sessionCurrency: 'USDT', sessionTimezone: 'UTC',
  } as Instrument,
];

function build() {
  const status = new MarketDataStatusService();
  const controller = new HealthController(
    { instruments, env: { get: () => false } } as never,
    status,
    { status: () => [] } as never,
    { healthStatus: () => ({ lastSuccessfulPollAge: null, eventsInWindow: 0 }) } as never,
  );
  return { status, controller };
}

/**
 * A bar closed a moment ago, so the age rule alone would never call this degraded.
 *
 * The bar is stamped at the START of the current minute, which makes its age 0-60 s — always under
 * the controller's 75 s threshold. Stamping it a minute earlier (the obvious "last closed bar")
 * gives an age of 60-120 s, so the spec passed or failed depending on where in the minute it ran.
 */
function freshBar(status: MarketDataStatusService, id: InstrumentId): void {
  status.recordClosedCandle(id, Math.floor(Date.now() / 60_000) * 60_000);
}

describe('GET /api/health reports venueStatus (BUG-021)', () => {
  it('carries each instrument’s venueStatus, and the response still validates', () => {
    const { status, controller } = build();
    for (const i of instruments) {
      status.setVenueStatus(i.id, 'up');
      freshBar(status, i.id);
    }

    const body = controller.get();
    expect(HealthResponseSchema.parse(body)).toBeTruthy();
    expect(body.instruments.map((i) => i.venueStatus)).toEqual(['up', 'up']);
    expect(body.status).toBe('ok');
  });

  it('is degraded when a venue says so, even though every bar is fresh — the BUG-021 case', () => {
    const { status, controller } = build();
    for (const i of instruments) freshBar(status, i.id);
    status.setVenueStatus('binance:BTCUSDT' as InstrumentId, 'up');
    status.setVenueStatus('capitalcom:US100' as InstrumentId, 'degraded');

    const body = controller.get();

    // the age rule sees nothing wrong: this is precisely the blind spot the bug was about
    expect(body.instruments.every((i) => (i.lastClosedCandleAge ?? 0) < 75_000)).toBe(true);
    expect(body.status).toBe('degraded');
    expect(body.instruments.find((i) => i.instrument === 'capitalcom:US100')?.venueStatus).toBe('degraded');
  });

  it('does not call the server degraded merely because an instrument is still down at boot', () => {
    const { status, controller } = build();
    for (const i of instruments) freshBar(status, i.id);
    // `down` is the status of an instrument whose warm-up has not finished yet
    status.setVenueStatus('capitalcom:US100' as InstrumentId, 'down');
    status.setVenueStatus('binance:BTCUSDT' as InstrumentId, 'up');

    const body = controller.get();
    expect(body.status).toBe('ok');
    expect(body.instruments.find((i) => i.instrument === 'capitalcom:US100')?.venueStatus).toBe('down');
  });

  it('does not call a closed market degraded', () => {
    const { status, controller } = build();
    for (const i of instruments) freshBar(status, i.id);
    status.setVenueStatus('capitalcom:US100' as InstrumentId, 'closed');
    status.setVenueStatus('binance:BTCUSDT' as InstrumentId, 'up');

    expect(controller.get().status).toBe('ok');
  });

  it('still reports degraded on a stale bar, with the venue reporting up', () => {
    const { status, controller } = build();
    for (const i of instruments) {
      status.setVenueStatus(i.id, 'up');
      freshBar(status, i.id);
    }
    status.recordClosedCandle('capitalcom:US100' as InstrumentId, Date.now() - 30 * 60_000);

    expect(controller.get().status).toBe('degraded');
  });
});

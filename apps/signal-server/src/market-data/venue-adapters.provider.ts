import { Logger } from '@nestjs/common';
import { Venue } from '@trade-automation/contracts';
import { BinanceAdapter } from '@trade-automation/binance-client';
import { Env } from '../config/env.schema';
import { AppConfigService } from '../config/config.service';
import { VenueAdapter } from './venue-adapter.port';
import { ReplayAdapter } from './replay/replay.adapter';
import { CapitalComAdapter } from './capitalcom/capitalcom.adapter';
import { CapitalComSession } from './capitalcom/capitalcom.session';

/**
 * Builds one VenueAdapter per venue actually used by the configured instrument universe,
 * per architecture/live-signal-server.md §4.1: ReplayAdapter for MARKET_DATA_MODE=replay
 * (dev/tests, no credentials needed), live adapters otherwise.
 */
export function buildVenueAdapters(config: AppConfigService): Map<Venue, VenueAdapter> {
  const env = config.env;
  const mode = env.get('MARKET_DATA_MODE');
  const venues = new Set(config.instruments.map((i) => i.venue));
  const adapters = new Map<Venue, VenueAdapter>();

  for (const venue of venues) {
    if (mode === 'replay') {
      adapters.set(venue, new ReplayAdapter(venue, env.get('REPLAY_FIXTURES_DIR'), env.get('REPLAY_SPEED')));
      continue;
    }

    const adapter = buildLiveVenueAdapter(venue, {
      BINANCE_REST_BASE_URL: env.get('BINANCE_REST_BASE_URL'),
      BINANCE_WS_BASE_URL: env.get('BINANCE_WS_BASE_URL'),
      CAPITAL_COM_BASE_URL: env.get('CAPITAL_COM_BASE_URL'),
      CAPITAL_COM_IDENTIFIER: env.get('CAPITAL_COM_IDENTIFIER'),
      CAPITAL_COM_PASSWORD: env.get('CAPITAL_COM_PASSWORD'),
      CAPITAL_COM_API_KEY: env.get('CAPITAL_COM_API_KEY'),
    });
    if (adapter) adapters.set(venue, adapter);
  }

  return adapters;
}

export type LiveVenueEnv = Pick<
  Env,
  | 'BINANCE_REST_BASE_URL'
  | 'BINANCE_WS_BASE_URL'
  | 'CAPITAL_COM_BASE_URL'
  | 'CAPITAL_COM_IDENTIFIER'
  | 'CAPITAL_COM_PASSWORD'
  | 'CAPITAL_COM_API_KEY'
>;

/**
 * The live adapter for one venue, from plain env values, so the standalone backfill job
 * (T-031) builds exactly what the server builds without booting Nest. Undefined for a venue with
 * no live adapter.
 */
export function buildLiveVenueAdapter(venue: Venue, env: LiveVenueEnv): VenueAdapter | undefined {
  // IB-001: the client lives in libs now and takes the logger it writes through; this is the Nest
  // Logger it constructed for itself before, with the same name.
  if (venue === 'binance') {
    return new BinanceAdapter(env.BINANCE_REST_BASE_URL, env.BINANCE_WS_BASE_URL, new Logger(BinanceAdapter.name));
  }
  if (venue === 'capitalcom') {
    const { CAPITAL_COM_IDENTIFIER: identifier, CAPITAL_COM_PASSWORD: password, CAPITAL_COM_API_KEY: apiKey } = env;
    if (!identifier || !password || !apiKey) {
      throw new Error(
        'MARKET_DATA_MODE=live requires CAPITAL_COM_IDENTIFIER/PASSWORD/API_KEY for capitalcom instruments',
      );
    }
    const session = new CapitalComSession(env.CAPITAL_COM_BASE_URL, identifier, password, apiKey);
    return new CapitalComAdapter(env.CAPITAL_COM_BASE_URL, session);
  }
  return undefined;
}

export const VENUE_ADAPTERS_MAP = Symbol('VENUE_ADAPTERS_MAP');

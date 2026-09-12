import { Venue } from '@trade-automation/contracts';
import { AppConfigService } from '../config/config.service';
import { VenueAdapter } from './venue-adapter.port';
import { ReplayAdapter } from './replay/replay.adapter';
import { BinanceAdapter } from './binance/binance.adapter';
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

    if (venue === 'binance') {
      adapters.set(venue, new BinanceAdapter(env.get('BINANCE_REST_BASE_URL'), env.get('BINANCE_WS_BASE_URL')));
    } else if (venue === 'capitalcom') {
      const identifier = env.get('CAPITAL_COM_IDENTIFIER');
      const password = env.get('CAPITAL_COM_PASSWORD');
      const apiKey = env.get('CAPITAL_COM_API_KEY');
      if (!identifier || !password || !apiKey) {
        throw new Error(
          'MARKET_DATA_MODE=live requires CAPITAL_COM_IDENTIFIER/PASSWORD/API_KEY for capitalcom instruments',
        );
      }
      const baseUrl = env.get('CAPITAL_COM_BASE_URL');
      const session = new CapitalComSession(baseUrl, identifier, password, apiKey);
      adapters.set(venue, new CapitalComAdapter(baseUrl, session));
    }
  }

  return adapters;
}

export const VENUE_ADAPTERS_MAP = Symbol('VENUE_ADAPTERS_MAP');

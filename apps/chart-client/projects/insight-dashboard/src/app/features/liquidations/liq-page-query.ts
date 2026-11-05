import {
  WebLiquidationsLargeQuerySchema,
  type WebLiquidationsLargePeriod, type WebLiquidationsLargeQuery, type WebMarketPeriod,
} from '@trade-automation/contracts';
import { LIQ_DEFAULT_SORT, parseLiqSort, type LiqSort } from './liq-table';

/**
 * IB-120 (market-round2 design §4) — the /liquidations view lives in its URL, so a link reproduces
 * it and a reload keeps it: `?p=7d&coin=BTCUSDT&min=1000000&side=short&venue=okx&sort=usd&dir=asc`.
 * A default is left out of the URL; a value the contract does not accept falls back to the default
 * for that one filter (a hand-edited link still opens, the server is never asked something it refuses).
 */
export interface LiqPageState {
  query: WebLiquidationsLargeQuery;
  sort: LiqSort;
  /** IB-134: episodes are the page (default); the IB-120 flat list is behind «все ликвидации списком →» (`?view=list`). */
  view: LiqView;
}

export type LiqView = 'episodes' | 'list';

/** URL name → the contract's query field. `p` is Market's own period parameter. */
const PARAM_OF = { period: 'p', symbol: 'coin', minUsd: 'min', side: 'side', venue: 'venue' } as const satisfies Record<keyof WebLiquidationsLargeQuery, string>;

const DEFAULT_QUERY = WebLiquidationsLargeQuerySchema.parse({});

export function parseLiqPage(get: (name: string) => string | null): LiqPageState {
  const query = { ...DEFAULT_QUERY };
  for (const field of Object.keys(PARAM_OF) as Array<keyof WebLiquidationsLargeQuery>) {
    const raw = get(PARAM_OF[field]);
    if (raw === null) continue;
    const one = WebLiquidationsLargeQuerySchema.shape[field].safeParse(raw);
    if (one.success) (query as Record<string, unknown>)[field] = one.data;
  }
  return { query, sort: parseLiqSort(get('sort'), get('dir')), view: get('view') === 'list' ? 'list' : 'episodes' };
}

/** Every URL parameter of the view; a default is `null`, which the router drops. */
export function liqPageParams(state: LiqPageState): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const field of Object.keys(PARAM_OF) as Array<keyof WebLiquidationsLargeQuery>) {
    const value = state.query[field];
    out[PARAM_OF[field]] = value === DEFAULT_QUERY[field] ? null : String(value);
  }
  const defaultSort = state.sort.column === LIQ_DEFAULT_SORT.column && state.sort.dir === LIQ_DEFAULT_SORT.dir;
  out['sort'] = defaultSort ? null : state.sort.column;
  out['dir'] = defaultSort ? null : state.sort.dir;
  out['view'] = state.view === 'list' ? 'list' : null;
  return out;
}

/**
 * Market's «Все ликвидации →»: /liquidations at Market's period. The page has 24h and 7d only
 * (§4), so Market's 1h and 4h open the 24h view, which contains them; the link never names a
 * period the page would silently replace.
 */
export function liquidationsPageLink(period: WebMarketPeriod): { commands: string[]; queryParams: { p: WebLiquidationsLargePeriod } } {
  return { commands: ['/liquidations'], queryParams: { p: period === '7d' ? '7d' : '24h' } };
}

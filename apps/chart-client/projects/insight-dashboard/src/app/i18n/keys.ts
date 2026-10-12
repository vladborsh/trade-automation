/**
 * architecture/insight-bot-web-dashboard.md §11 — every dashboard string lives in a typed table.
 *
 * The key union is the contract: `Strings` is `Record<StringKey, string>`, so **a table missing a
 * key does not compile**. That is deliberately stronger than a runtime check — the loud failure the
 * task asks for is for keys that can only be known at runtime (a code from the API), which
 * `I18nService.t` handles separately.
 *
 * What is NOT in here, by the same §11: tickers (`BTCUSDT`), venue names, playbook codes (`P3`),
 * timeframes (`15m`), raw DB/field names in tables of data, and units. Those stay English in both
 * languages, and translating them would make a screen harder to read, not easier.
 */
export type StringKey =
  // shell
  | 'nav.brand'
  | 'nav.instrument'
  | 'nav.health'
  | 'nav.coverage'
  // shared controls
  | 'action.refresh'
  | 'state.loading'
  | 'state.never'
  // login
  | 'login.title'
  | 'login.hint'
  | 'login.continue'
  | 'login.signingIn'
  | 'login.noToken'
  | 'login.useBot'
  | 'login.invalid'
  | 'login.used'
  | 'login.failed'
  | 'login.unreachable'
  | 'login.switchLang'
  // health
  | 'health.title'
  | 'health.streams'
  | 'health.streamsDegraded'
  | 'health.col.stream'
  | 'health.col.venue'
  | 'health.col.mode'
  | 'health.col.lastMessage'
  | 'health.col.reconnects'
  | 'health.col.openGaps'
  | 'health.openGapsTotal'
  | 'health.weight'
  | 'health.weightNone'
  | 'health.weightPerMinute'
  | 'health.gapReports'
  | 'health.gapReportsWorst'
  | 'health.gapReportsClean'
  | 'health.col.symbol'
  | 'health.database'
  | 'health.dbSize'
  | 'health.dbPartitions'
  // coverage
  | 'coverage.title'
  | 'coverage.col.symbol'
  | 'coverage.col.series'
  | 'coverage.col.first'
  | 'coverage.col.last'
  | 'coverage.col.missingMonths'
  | 'coverage.summary.none'
  | 'coverage.summary.complete'
  | 'coverage.summary.problems'
  // instrument view (IB-031)
  | 'instrument.symbol'
  | 'instrument.range'
  | 'instrument.timeframe'
  | 'instrument.market'
  | 'instrument.coarsened'
  | 'instrument.downsampled'
  | 'instrument.loadFailed'
  | 'instrument.topTitle'
  | 'instrument.noLiquidations'
  | 'instrument.pane.liquidations'
  | 'instrument.pane.liquidationsUndercounted'
  | 'instrument.panel.price'
  | 'instrument.panel.openInterest'
  | 'instrument.panel.liquidations'
  | 'instrument.panel.delta'
  | 'instrument.panel.funding'
  | 'instrument.panel.longShort'
  | 'instrument.unit.usd'
  | 'instrument.unit.contracts'
  | 'instrument.unit.percent'
  | 'instrument.unit.ratio'
  | 'instrument.legend.longs'
  | 'instrument.legend.shorts'
  | 'instrument.legend.cvd'
  | 'instrument.legend.delta'
  | 'instrument.legend.settled'
  | 'instrument.legend.predicted'
  | 'instrument.scrollHint'
  | 'instrument.venue.all'
  | 'range.1d'
  | 'range.3d'
  | 'range.1w'
  | 'range.1m'
  | 'range.3m'
  | 'range.1y'
  // IB-038 — the liquidation surfaces on the landing page (design §12.1–§12.4).
  | 'liq.now.title'
  | 'liq.where.title'
  | 'liq.feed.title'
  | 'liq.window.1h'
  | 'liq.window.4h'
  | 'liq.window.24h'
  | 'liq.side.longs'
  | 'liq.side.shorts'
  | 'liq.leaning.longs'
  | 'liq.leaning.shorts'
  | 'liq.leaning.quiet'
  | 'liq.norm.label'
  | 'liq.norm.basis'
  | 'liq.norm.noHistory'
  | 'liq.norm.noNorm'
  | 'liq.norm.absent'
  | 'liq.venues.missing'
  | 'liq.venues.present'
  | 'liq.unmapped'
  | 'liq.where.coin'
  | 'liq.where.empty'
  | 'liq.feed.threshold'
  | 'liq.feed.empty'
  | 'liq.feed.col.time'
  | 'liq.feed.col.coin'
  | 'liq.feed.col.side'
  | 'liq.feed.col.usd'
  | 'liq.feed.col.price'
  | 'liq.feed.col.venue'
  | 'liq.loadFailed'
  | 'liq.placeholder';

/** Both tables must cover every key, or the project does not compile. */
export type Strings = Record<StringKey, string>;

export const LANGUAGES = ['ru', 'en'] as const;
export type Lang = (typeof LANGUAGES)[number];

/** §11: `ru` by default, `en` the per-user alternative. */
export const DEFAULT_LANG: Lang = 'ru';

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

import { WEB_MARKET_PERIOD_SECONDS, type WebFlowsChange, type WebInsightBasis, type WebInsightStatement, type WebPositioningRow, type WebVenueKey } from '@trade-automation/contracts';
import { levelRarity, rarity } from './rarity';
import { bucketMeans, sparkOf, sparkWithNow } from './spark';
import { fngBand } from './sentiment';
import { LIQ_RULE_MIN_DAYS, PREMIUM_SUSTAINED_MIN, R2_MIN_USD, RARITY_SHOW, VENUE_RULE_MIN_DAYS } from './thresholds';
import type { InsightSnapshot, Refusal, Rule } from './types';

/**
 * IB-086 (market-page design D5) — rule set v1. Each rule: snapshot → statement | refusal | null.
 * Rarity is the D2 scale; the ENGINE drops anything under 0.90, so a rule reports what it measured
 * and never decides visibility itself. Every statement carries its basis (D3), and every rule
 * refuses on a thin basis: liquidations need 7 days of our own tape, venue series 20 days.
 *
 * R1 liquidation surge by side, market-wide — the side whose period USD is rarest in its own sample
 *    of aligned windows; magnitude = × median.
 * R2 the coin with the most unusual liquidations — rarest period USD in the coin's own sample, among
 *    coins above `R2_MIN_USD` (a $40k alt is not news).
 * R3 a cascade — the period's largest series (≥ 3 same-side events ≥ $100k within 10 min, IB-084's
 *    grouping), rare against the market's HOURLY totals: ten minutes that outweigh most whole hours.
 * R4 OI vs price — |ΔOI| rare while |Δprice| is not; named by quadrant.
 * R5 funding extremes — coins whose funding is beyond their own 30-day p95/p5 (two-sided rarity ≥ 0.90);
 *    the most extreme is named.
 * R6 crowd vs top traders — global account L/S and top-trader POSITION L/S on opposite sides of 1,
 *    both rare. (The gap's own history is not held; "both rare, opposite sides" is the stated proxy.)
 * R7 sentiment and breadth — share of coins up and median alt change minus BTC, each two-sided rare
 *    in its own hourly history; F&G band in the params for the wording.
 */
// IB-BUG-032: typed against the display-name map, so a venue added here without a name does not compile
const venuesAll: WebVenueKey[] = ['binance', 'bybit', 'okx'];
const sec = (ms: number | null) => (ms === null ? null : Math.floor(ms / 1000));
const median = (xs: readonly number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

function liqBasis(s: InsightSnapshot, sample: readonly number[]): WebInsightBasis {
  const l = s.liquidations;
  return {
    window: s.period,
    venues: l?.venues ?? venuesAll,
    sampleWindows: sample.length,
    observedWindows: sample.filter((v) => v > 0).length,
    from: sec(l?.fromMs ?? null),
  };
}

function cellBasis(s: InsightSnapshot, sample: number): WebInsightBasis {
  return { window: s.period, venues: ['binance'], sampleWindows: sample, observedWindows: sample, from: sec(s.nowMs - 30 * 86_400_000) };
}

const refuse = (refused: Refusal['refused'], basis: WebInsightBasis | null = null): Refusal => ({ refused, basis });

/**
 * IB-107 (design D24, §7.3) — each statement's mini-chart, from the series the rule itself read:
 * the tail lengths of the table in §7.3. "Now" (the last value) is highlighted unless a rule names
 * another bar (R3's cascade hour) or none (R4/R6: hourly points up to an hour old, the title's figure
 * is current).
 */
const SPARK = { bars: 24, coinWindows: 14, hours: 24, settlements: 21, flows: 30, premiumWindowSec: 3_600, premiumStepSec: 120 } as const;
const lastLit = (xs: readonly number[], max: number) => sparkOf(xs.slice(-max), Math.min(xs.length, max) - 1, max);

export const R1: Rule = {
  id: 'R1', block: 'liquidations', sources: ['tape'],
  run(s) {
    const l = s.liquidations;
    if (!l) return refuse('no_data');
    if (s.period === '7d' || l.days < LIQ_RULE_MIN_DAYS) return refuse('insufficient_history', liqBasis(s, l.long.sample));
    const sides = (['long', 'short'] as const).map((side) => {
      const r = rarity(l[side].usd, l[side].sample);
      const m = median(l[side].sample);
      return { side, r: r ?? 0, usd: l[side].usd, ratio: m && m > 0 ? l[side].usd / m : null };
    }).sort((a, b) => b.r - a.r || b.usd - a.usd);
    const top = sides[0] as (typeof sides)[number];
    if (top.usd <= 0) return null;
    return {
      ruleId: 'R1', block: 'liquidations', key: 'insight.liq_surge',
      params: { side: top.side, usd: top.usd, ratio: top.ratio },
      rarity: top.r, magnitude: top.ratio ?? top.usd, basis: liqBasis(s, l[top.side].sample), link: { anchor: 'liquidations' },
      spark: lastLit(l.bars.map((b) => b[top.side]), SPARK.bars),
    };
  },
};

export const R2: Rule = {
  id: 'R2', block: 'liquidations', sources: ['tape'],
  run(s) {
    const l = s.liquidations;
    if (!l) return refuse('no_data');
    if (s.period === '7d') return refuse('insufficient_history', liqBasis(s, []));
    const measured = [...l.coins.entries()].filter(([, c]) => c.days >= LIQ_RULE_MIN_DAYS);
    if (measured.length === 0) return refuse('insufficient_history', liqBasis(s, []));
    const best = measured
      .filter(([, c]) => c.usd >= R2_MIN_USD)
      .map(([symbol, c]) => ({ symbol, c, r: rarity(c.usd, c.sample) ?? 0 }))
      .sort((a, b) => b.r - a.r || b.c.usd - a.c.usd)[0];
    if (!best) return null;
    const m = median(best.c.sample);
    return {
      ruleId: 'R2', block: 'liquidations', key: 'insight.liq_coin',
      params: { symbol: best.symbol, usd: best.c.usd, ratio: m && m > 0 ? best.c.usd / m : null },
      rarity: best.r, magnitude: best.c.usd, basis: liqBasis(s, best.c.sample),
      link: { route: 'instrument', symbol: best.symbol, timeSec: null },
      spark: sparkWithNow(best.c.sample, best.c.usd, SPARK.coinWindows + 1),
    };
  },
};

export const R3: Rule = {
  id: 'R3', block: 'liquidations', sources: ['tape'],
  run(s) {
    const l = s.liquidations;
    if (!l) return refuse('no_data');
    if (l.hourlyDays < LIQ_RULE_MIN_DAYS) return refuse('insufficient_history', liqBasis(s, l.hourly));
    const bySeries = new Map<string, typeof l.large>();
    for (const e of l.large) if (e.seriesId) bySeries.set(e.seriesId, [...(bySeries.get(e.seriesId) ?? []), e]);
    const series = [...bySeries.values()].map((events) => {
      const biggest = [...events].sort((a, b) => b.usd - a.usd)[0] as (typeof events)[number];
      return {
        usd: events.reduce((sum, e) => sum + e.usd, 0),
        side: biggest.side, symbol: biggest.symbol, count: biggest.seriesCount, spanSec: biggest.seriesSpanSec,
        start: Math.min(...events.map((e) => e.time)),
      };
    }).sort((a, b) => b.usd - a.usd);
    const top = series[0];
    if (!top) return null;
    return {
      ruleId: 'R3', block: 'liquidations', key: 'insight.liq_cascade',
      params: { side: top.side, count: top.count, minutes: Math.max(1, Math.ceil(top.spanSec / 60)), usd: top.usd, symbol: top.symbol },
      rarity: rarity(top.usd, l.hourly) ?? 0, magnitude: top.usd, basis: liqBasis(s, l.hourly),
      link: { route: 'instrument', symbol: top.symbol, timeSec: top.start },
      spark: cascadeSpark(l.bars, top.side, top.start),
    };
  },
};

/** R3: the market's bars of the cascade's side over the period, the cascade's own bar lit. */
function cascadeSpark(bars: readonly { time: number; long: number; short: number }[], side: 'long' | 'short', startSec: number) {
  let at: number | null = null;
  bars.forEach((b, i) => { if (b.time <= startSec) at = i; });
  return sparkOf(bars.map((b) => b[side]), at);
}

/** The positioning rules refuse together when no row has the cell measured (under 20 days, or 7d). */
function measuredRows(s: InsightSnapshot, has: (r: WebPositioningRow) => boolean): WebPositioningRow[] | Refusal {
  if (!s.positioning) return refuse('no_data');
  const rows = s.positioning.filter(has);
  return rows.length === 0 ? refuse('insufficient_history', cellBasis(s, 0)) : rows;
}

export const R4: Rule = {
  id: 'R4', block: 'positioning', sources: ['binance'],
  run(s) {
    const rows = measuredRows(s, (r) => r.oiChangePct.rarity !== null && r.priceChangePct.rarity !== null);
    if (!Array.isArray(rows)) return rows;
    const best = rows
      .filter((r) => (r.priceChangePct.rarity as number) < RARITY_SHOW)
      // IB-BUG-027: named by one of the four quadrants (design D5) — never `flat`. Rarity is the
      // coin's OWN history, the quadrant is absolute (|OI| < OI_FLAT_PCT): a +0.81 % that is rare
      // for a coin whose OI barely moves is still «без изменений», which says nothing.
      .filter((r) => r.quadrant !== null && r.quadrant !== 'flat')
      .sort((a, b) => (b.oiChangePct.rarity as number) - (a.oiChangePct.rarity as number) || Math.abs(b.oiChangePct.value ?? 0) - Math.abs(a.oiChangePct.value ?? 0))[0];
    if (!best) return null;
    return {
      ruleId: 'R4', block: 'positioning', key: 'insight.oi_vs_price',
      params: { symbol: best.symbol, quadrant: best.quadrant, oiPct: best.oiChangePct.value, pricePct: best.priceChangePct.value },
      rarity: best.oiChangePct.rarity as number, magnitude: Math.abs(best.oiChangePct.value ?? 0),
      // IB-BUG-023: a change over the period has no single moment — it links to the period's start
      basis: cellBasis(s, best.oiChangePct.sample),
      link: { route: 'instrument', symbol: best.symbol, timeSec: Math.floor(s.nowMs / 1000) - WEB_MARKET_PERIOD_SECONDS[s.period] },
      spark: sparkOf((s.positioningSeries?.get(best.symbol)?.oi ?? []).slice(-SPARK.hours), null),
    };
  },
};

export const R5: Rule = {
  id: 'R5', block: 'positioning', sources: ['binance'],
  run(s) {
    const rows = measuredRows(s, (r) => r.fundingRate.rarity !== null && r.fundingRate.value !== null);
    if (!Array.isArray(rows)) return rows;
    const extreme = rows.filter((r) => (r.fundingRate.rarity as number) >= RARITY_SHOW)
      .sort((a, b) => (b.fundingRate.rarity as number) - (a.fundingRate.rarity as number) || Math.abs(b.fundingRate.value as number) - Math.abs(a.fundingRate.value as number));
    const top = extreme[0];
    if (!top) return null;
    return {
      ruleId: 'R5', block: 'positioning', key: 'insight.funding_extremes',
      params: { count: extreme.length, total: rows.length, symbol: top.symbol, rate: top.fundingRate.value },
      rarity: top.fundingRate.rarity as number, magnitude: extreme.length,
      basis: cellBasis(s, top.fundingRate.sample), link: { anchor: 'positioning' },
      spark: lastLit(s.positioningSeries?.get(top.symbol)?.funding ?? [], SPARK.settlements),
    };
  },
};

export const R6: Rule = {
  id: 'R6', block: 'positioning', sources: ['binance'],
  run(s) {
    const rows = measuredRows(s, (r) => r.lsGlobal.rarity !== null && r.lsTopPosition.rarity !== null);
    if (!Array.isArray(rows)) return rows;
    const opposed = rows
      .filter((r) => r.lsGlobal.value !== null && r.lsTopPosition.value !== null && (r.lsGlobal.value - 1) * (r.lsTopPosition.value - 1) < 0)
      .map((r) => ({ r, rar: Math.min(r.lsGlobal.rarity as number, r.lsTopPosition.rarity as number) }))
      .sort((a, b) => b.rar - a.rar)[0];
    if (!opposed) return null;
    const { r, rar } = opposed;
    return {
      ruleId: 'R6', block: 'positioning', key: 'insight.crowd_vs_top',
      params: { symbol: r.symbol, global: r.lsGlobal.value, top: r.lsTopPosition.value },
      rarity: rar, magnitude: Math.abs(Math.log((r.lsGlobal.value as number) / (r.lsTopPosition.value as number))),
      basis: cellBasis(s, Math.min(r.lsGlobal.sample, r.lsTopPosition.sample)), link: { route: 'instrument', symbol: r.symbol, timeSec: null },
      spark: sparkOf((s.positioningSeries?.get(r.symbol)?.lsGlobal ?? []).slice(-SPARK.hours), null),
    };
  },
};

export const R7: Rule = {
  id: 'R7', block: 'sentiment', sources: ['binance'],
  run(s) {
    const b = s.breadth;
    if (!b) return refuse('no_data');
    const basis = { ...cellBasis(s, b.upShareSample.length), venues: ['binance'] };
    if (s.period === '7d' || b.days < VENUE_RULE_MIN_DAYS) return refuse('insufficient_history', basis);
    const rUp = levelRarity(b.upShare, b.upShareSample) ?? 0;
    const rGap = levelRarity(b.altGapPct, b.altGapSample) ?? 0;
    return {
      ruleId: 'R7', block: 'sentiment', key: 'insight.breadth',
      params: { upPct: Math.round(b.upShare * 100), altGapPct: Math.round(b.altGapPct * 100) / 100, fngBand: s.fng === null ? null : fngBand(s.fng) },
      rarity: Math.max(rUp, rGap), magnitude: Math.abs(b.altGapPct), basis, link: { anchor: 'sentiment' },
      // the series that made it speak: the alt gap (signed) when it is the rarer, else the share up
      spark: rGap >= rUp
        ? sparkWithNow(b.altGapSample, b.altGapPct, SPARK.hours)
        : sparkWithNow(b.upShareSample.map((x) => x * 100), b.upShare * 100, SPARK.hours),
    };
  },
};

// ---- IB-091 «Деривативы и потоки» (phase 2) ----------------------------------------------------

/** A phase-2 basis: the source, how many past values the rarity was measured against, from when. */
function flowsBasis(s: InsightSnapshot, window: WebInsightBasis['window'], venues: WebVenueKey[], c: WebFlowsChange): WebInsightBasis {
  return { window, venues, sampleWindows: c.sample, observedWindows: c.sample, from: sec(s.nowMs - c.sampleDays * 86_400_000) };
}

/** R8 — BTC implied vol (Deribit DVOL) ROSE unusually over the period: a spike is a rise (TL ruling). */
export const R8: Rule = {
  id: 'R8', block: 'flows', sources: ['deribit'],
  run(s) {
    const t = s.flows?.dvol;
    if (!t || t.value === null || !t.change) return refuse('no_data');
    const basis = flowsBasis(s, s.period, ['deribit'], t.change);
    if (t.change.rarity === null) return refuse('insufficient_history', basis);
    if (t.change.value <= 0) return null;
    return {
      ruleId: 'R8', block: 'flows', key: 'insight.dvol_spike',
      params: { value: t.value, change: t.change.value },
      rarity: t.change.rarity, magnitude: t.change.value, basis, link: { anchor: 'flows' },
      spark: lastLit(t.series.map((p) => p.value), SPARK.flows),
    };
  },
};

/** R9 — total stablecoin supply moved unusually in 1 day (7 on the 7d page): a mint or a burn. */
export const R9: Rule = {
  id: 'R9', block: 'flows', sources: ['defillama'],
  run(s) {
    const t = s.flows?.stablecoins;
    if (!t || t.supplyUsd === null || !t.changeUsd) return refuse('no_data');
    // the basis says what was measured: a 1-day or a 7-day change, whatever the page's period
    const basis = flowsBasis(s, t.changeDays === 7 ? '7d' : '24h', ['defillama'], t.changeUsd);
    if (t.changeUsd.rarity === null) return refuse('insufficient_history', basis);
    return {
      ruleId: 'R9', block: 'flows', key: 'insight.stablecoin_supply',
      params: { usd: t.changeUsd.value, pct: t.changePct, days: t.changeDays },
      rarity: t.changeUsd.rarity, magnitude: Math.abs(t.changeUsd.value), basis, link: { anchor: 'flows' },
      spark: lastLit(t.series.map((p) => p.value), SPARK.flows),
    };
  },
};

/**
 * R10 — Coinbase BTC held a premium or a discount (D18: against the dollar, USDT divided out) for
 * most of the last hour, unusually for the last 25 days. Too few valid minutes refuses
 * (`insufficient_minutes`); a premium that flips sign is not sustained and says nothing.
 */
export const R10: Rule = {
  id: 'R10', block: 'flows', sources: ['coinbase', 'binance'],
  run(s) {
    const t = s.flows?.coinbasePremium;
    if (!t || !t.premiumPct) return refuse('no_data');
    const basis = flowsBasis(s, '1h', ['coinbase', 'binance'], t.premiumPct);
    if (t.unavailable === 'insufficient_minutes') return refuse('insufficient_minutes', basis);
    if (t.premiumPct.rarity === null) return refuse('insufficient_history', basis);
    if (t.sameSignMinutes < PREMIUM_SUSTAINED_MIN) return null;
    return {
      ruleId: 'R10', block: 'flows', key: 'insight.coinbase_premium',
      params: { pct: t.premiumPct.value, minutes: t.sameSignMinutes },
      rarity: t.premiumPct.rarity, magnitude: Math.abs(t.premiumPct.value), basis, link: { anchor: 'flows' },
      // 60 minutes → 30 two-minute means (signed)
      spark: lastLit(bucketMeans(t.series, SPARK.premiumWindowSec, SPARK.premiumStepSec), SPARK.flows),
    };
  },
};

/**
 * R11 (IB-113, OI divergence design V16) — the newest on-time OI divergence ALERT of the last 24 h on
 * a listed coin, read from the journal (the alert loop already judged it; this rule only shows it). It
 * makes no venue call. **An event, not a percentile:** rarity 1 ranks it first and is never rendered;
 * magnitude is |OI change| for the tie-break. No alert in the window → null (ran, nothing to say): the
 * positioning block's other rules still speak.
 */
export const R11: Rule = {
  id: 'R11', block: 'positioning', sources: ['binance'],
  run(s) {
    const d = s.oiDivergence;
    if (!d) return null;
    const a = d.alert;
    const pricePct = (a.b.price / a.a.price - 1) * 100;
    const oiPct = (a.b.oi / a.a.oi - 1) * 100;
    return {
      ruleId: 'R11', block: 'positioning', key: 'insight.oi_divergence',
      params: { symbol: a.symbol, tf: a.tf, direction: a.direction, pricePct, oiPct, runLength: a.runLength },
      rarity: 1, magnitude: Math.abs(oiPct),
      basis: { window: '24h', venues: ['binance'], sampleWindows: 0, observedWindows: 0, from: null },
      link: { route: 'instrument', symbol: a.symbol, timeSec: a.b.time },
      spark: lastLit(d.oiSeries, SPARK.flows),
    };
  },
};

export const RULES: readonly Rule[] = [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11];

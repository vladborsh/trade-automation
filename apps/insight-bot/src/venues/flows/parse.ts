/**
 * IB-091 — the four phase-2 sources' answers, parsed. Pure, and strict: a shape these do not
 * recognise throws (the caller turns that into `source_unavailable`), because a misread venue
 * series would otherwise flow straight into a rarity and a sentence. Each shape is pinned by a
 * fixture of a real answer (`test/fixtures/{deribit,okx,defillama,coinbase}`).
 */
export interface TimedValue {
  timeSec: number;
  value: number;
}

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const num = (x: unknown, what: string): number => {
  const n = typeof x === 'string' ? Number(x) : x;
  if (!fin(n)) throw new Error(`${what}: not a number (${JSON.stringify(x)})`);
  return n;
};
const ascending = <T extends { timeSec: number }>(rows: T[]): T[] => rows.sort((a, b) => a.timeSec - b.timeSec);

/** Deribit `get_volatility_index_data`: `result.data` = `[ts_ms, open, high, low, close]` → closes, oldest first. */
export function parseDvol(body: unknown): TimedValue[] {
  const data = (body as { result?: { data?: unknown } })?.result?.data;
  if (!Array.isArray(data)) throw new Error('Deribit DVOL: no result.data[]');
  return ascending(data.map((r) => {
    if (!Array.isArray(r) || r.length < 5) throw new Error('Deribit DVOL: a row is not [ts, o, h, l, c]');
    const value = num(r[4], 'Deribit DVOL close');
    if (value <= 0) throw new Error(`Deribit DVOL: a non-positive index ${value}`);
    return { timeSec: Math.floor(num(r[0], 'Deribit DVOL ts') / 1000), value };
  }));
}

export interface PutCallDay {
  timeSec: number;
  oiRatio: number;
  volumeRatio: number;
}

/**
 * OKX rubik `option/open-interest-volume-ratio`: `{ code: '0', data: [[ts, oiRatio, volRatio], …] }`,
 * strings, newest first. The column order is OKX's documented one (rubik arrays are positional and
 * differ per endpoint — the survey's warning); a ratio below 0 cannot be either column, so it throws.
 */
export function parsePutCall(body: unknown): PutCallDay[] {
  const b = body as { code?: unknown; msg?: unknown; data?: unknown };
  if (b?.code !== '0') throw new Error(`OKX rubik: code ${JSON.stringify(b?.code)} ${JSON.stringify(b?.msg ?? '')}`);
  if (!Array.isArray(b.data)) throw new Error('OKX rubik: no data[]');
  return ascending(b.data.map((r) => {
    if (!Array.isArray(r) || r.length < 3) throw new Error('OKX rubik: a row is not [ts, oiRatio, volRatio]');
    const oiRatio = num(r[1], 'OKX oiRatio');
    const volumeRatio = num(r[2], 'OKX volRatio');
    if (oiRatio < 0 || volumeRatio < 0) throw new Error('OKX rubik: a negative put/call ratio');
    return { timeSec: Math.floor(num(r[0], 'OKX ts') / 1000), oiRatio, volumeRatio };
  }));
}

/**
 * DefiLlama `stablecoincharts/all` → the daily supply of USD-pegged stablecoins **in coins**
 * (`totalCirculating.peggedUSD`), NOT `totalCirculatingUSD` (coins × price). TL ruling 2026-11-04,
 * after the R9 check: «предложение» is a number of coins, so a de-peg must never read as a burn —
 * in the checked week 12 % of the priced fall was coins trading just under $1, nothing burned.
 */
export function parseStablecoinTotals(body: unknown): TimedValue[] {
  if (!Array.isArray(body)) throw new Error('DefiLlama: the chart is not an array');
  return ascending(body.map((r: { date?: unknown; totalCirculating?: { peggedUSD?: unknown } }) => ({
    timeSec: num(r?.date, 'DefiLlama date'),
    value: num(r?.totalCirculating?.peggedUSD, 'DefiLlama totalCirculating.peggedUSD'),
  })));
}

/**
 * Coinbase Exchange `candles`: `[time, LOW, HIGH, OPEN, CLOSE, volume]`, newest first — NOT
 * Binance's order. Asserted on every row (low ≤ open, close ≤ high), so a column swap throws
 * instead of silently turning lows into closes. → closes, oldest first.
 */
export function parseCoinbaseCandles(body: unknown): TimedValue[] {
  if (!Array.isArray(body)) throw new Error('Coinbase: candles are not an array');
  return ascending(body.map((r) => {
    if (!Array.isArray(r) || r.length < 5) throw new Error('Coinbase: a candle is not [time, low, high, open, close, …]');
    const [t, low, high, open, close] = [0, 1, 2, 3, 4].map((i) => num(r[i], `Coinbase column ${i}`));
    if (!(low <= Math.min(open, close) && high >= Math.max(open, close))) {
      throw new Error(`Coinbase: candle ${t} breaks low ≤ open, close ≤ high — the columns are not [time, low, high, open, close]`);
    }
    return { timeSec: t, value: close };
  }));
}

/**
 * D18 — the Coinbase premium against the DOLLAR, USDT divided out:
 * CB BTC-USD ÷ (BN BTCUSDT × CB USDT-USD) − 1, in %, only at the times all three closes exist.
 * A time missing any of them is MISSING — never computed from the raw difference.
 */
export function premiumSeries(cbBtcUsd: readonly TimedValue[], cbUsdtUsd: readonly TimedValue[], bnBtcUsdt: readonly TimedValue[]): TimedValue[] {
  const usdt = new Map(cbUsdtUsd.map((p) => [p.timeSec, p.value]));
  const bn = new Map(bnBtcUsdt.map((p) => [p.timeSec, p.value]));
  const out: TimedValue[] = [];
  for (const p of cbBtcUsd) {
    const u = usdt.get(p.timeSec);
    const b = bn.get(p.timeSec);
    if (u === undefined || b === undefined || !(u > 0) || !(b > 0)) continue;
    out.push({ timeSec: p.timeSec, value: (p.value / (b * u) - 1) * 100 });
  }
  return out;
}

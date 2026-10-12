import { Client } from 'pg';
import type { Candle } from '@trade-automation/contracts';
import { ema } from '@trade-automation/indicators';
import { REGIME_SPEC } from './regime-spec';

/**
 * IB-016 — how often does the trend axis's EMA slope change sign?
 *
 * **This exists because a number that informs a design decision must come with its query** (Tech
 * Lead, 2026-10-12). The slope has no deadband, which is only defensible while the sign does not
 * flap; "it does not flap" is a measurement, and a measurement nobody can re-run is an assertion
 * with a decimal point.
 *
 * The first version of this lived in a scratch file and was **wrong**: it selected on `symbol` and
 * `tf` alone, and `candles_agg` holds `binance/spot` and `binance/perp` rows at the same
 * `open_time`. The EMA therefore ran over two interleaved books whose same-minute closes differ by
 * ~$40 on BTC — a sawtooth, which tripled the apparent flip rate (0.09/day against the true
 * 0.03/day). **The series key is `(symbol, venue, market)`**, and this file exists so the next
 * person inherits the query rather than the number.
 *
 * Run: `npm run measure:trend-flips` (needs `DATABASE_URL`). Read-only.
 */

/** `ema.4h.50` → `{ tf: '4h', length: 50 }`; a key that does not parse is a spec error, not a default. */
function parseEmaKey(key: string): { tf: string; length: number } {
  const match = /^ema\.([0-9a-z]+)\.(\d+)$/.exec(key);
  if (!match) throw new Error(`regime trend's fastKey "${key}" is not an ema.<tf>.<length> key`);
  return { tf: match[1], length: Number(match[2]) };
}

interface SeriesFlips {
  symbol: string;
  venue: string;
  market: string;
  frames: number;
  days: number;
  flips: number;
  flatSlopes: number;
  barsPerDay: number;
}

/** Sign flips of the EMA slope over a single series. Pure, so the counting rule is testable. */
export function countSlopeFlips(
  emaValues: readonly number[],
  slopeBars: number,
): { frames: number; flips: number; flatSlopes: number } {
  let frames = 0;
  let flips = 0;
  let flatSlopes = 0;
  let previous: number | null = null;
  for (let i = slopeBars; i < emaValues.length; i += 1) {
    const slope = emaValues[i] - emaValues[i - slopeBars];
    const sign = slope > 0 ? 1 : slope < 0 ? -1 : 0;
    if (sign === 0) flatSlopes += 1;
    frames += 1;
    if (previous !== null && sign !== previous) flips += 1;
    previous = sign;
  }
  return { frames, flips, flatSlopes };
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const { tf, length } = parseEmaKey(REGIME_SPEC.trend.params.fastKey);
  const slopeBars = REGIME_SPEC.trend.params.slopeBars;

  const client = new Client({ connectionString });
  await client.connect();
  try {
    // THE SERIES KEY IS (symbol, venue, market) — see the file docblock.
    const series = await client.query<{ symbol: string; venue: string; market: string }>(
      `select symbol, venue, market, count(*) as n
         from candles_agg
        where complete and tf = $1
        group by symbol, venue, market
       having count(*) >= $2
        order by count(*) desc`,
      [tf, length + slopeBars + 10],
    );

    console.log(
      `trend flip rate — ema length ${length} on ${tf}, slope over ${slopeBars} bars; ` +
        `${series.rows.length} series with enough history`,
    );

    const results: SeriesFlips[] = [];
    for (const { symbol, venue, market } of series.rows) {
      const bars = await client.query<{ open_time: Date; open: string; high: string; low: string; close: string }>(
        `select open_time, open, high, low, close
           from candles_agg
          where complete and tf = $1 and symbol = $2 and venue = $3 and market = $4
          order by open_time`,
        [tf, symbol, venue, market],
      );
      // `ema` reads only the closes, but it takes the monorepo's Candle, so the row is widened to
      // it rather than a second close-only EMA being written here.
      const candles: Candle[] = bars.rows.map((row) => ({
        instrument: `binance:${symbol}` as Candle['instrument'],
        timeframe: tf as Candle['timeframe'],
        openTime: row.open_time.getTime(),
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: 0,
        closed: true,
        source: 'rest' as Candle['source'],
      }));
      const values = ema(candles, { length }).ema
        .map((point) => point.value)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      const { frames, flips, flatSlopes } = countSlopeFlips(values, slopeBars);

      // The denominator is the window in which a flip could actually have been OBSERVED, not the
      // span of the bars: the EMA is undefined for its first `length - 1` bars and the slope for
      // `slopeBars` more, so counting those as days with no flip understates the rate.
      const firstEvaluated = candles.length - values.length + slopeBars;
      const spanMs = candles[candles.length - 1].openTime - candles[firstEvaluated].openTime;
      const days = Math.max(spanMs / 86_400_000, 1 / 24);
      results.push({
        symbol, venue, market, frames, flips, flatSlopes,
        days,
        // the density caveat, printed with every row: a tape holding fewer bars per day than the
        // timeframe implies makes a `slopeBars`-bar slope span more wall time than intended, which
        // smooths it — so a low flip rate measured on a sparse tape is a LOWER BOUND
        barsPerDay: (candles.length - firstEvaluated) / days,
      });
    }

    for (const row of results) {
      console.log(
        `${row.symbol} ${row.venue}/${row.market}: ${row.frames} frames over ${row.days.toFixed(1)} d — ` +
          `${row.flips} sign flips = ${(row.flips / row.days).toFixed(3)}/day; ` +
          `flat slopes ${row.flatSlopes}; density ${row.barsPerDay.toFixed(2)} bars/day ` +
          `(a complete ${tf} tape has ${(24 / Number(tf.replace('h', ''))).toFixed(0)}/day)`,
      );
    }
    if (results.length === 0) console.log('no series has enough history yet — this needs the archive backfill');
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}

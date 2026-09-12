import * as fs from 'fs';
import * as path from 'path';
import { Candle, InstrumentId } from '@trade-automation/contracts';
import { CandleCache } from '../../src/market-data/candle-cache.service';
import { sliceWindows } from '../../src/strategy-engine/strategies/vwap-band-reversal/vwap-band-reversal.windows';
import { Evaluation, evaluate } from '../../src/strategy-engine/strategies/vwap-band-reversal/vwap-band-reversal.evaluate';

/**
 * architecture/vwap-band-reversal-plugin.md §5.3, §8.1 step 6 — the correctness gate for this
 * plug-in: bar-for-bar agreement with the Researcher's TypeScript<->Python bit-exact
 * reproduction. The fixture is exported from `researcher-cmc-bot-vwap`'s Stage-0 close-out and
 * is NOT expected to exist at the time this test is first written — see HANDOFF.md item (b) of
 * this build's routing note. When absent, this suite SKIPS LOUDLY (a clear console message and
 * a single `it.skip`, never a silent pass) so CI is green-because-pending, not
 * green-because-nothing-ran.
 */
const FIXTURES_ROOT = path.resolve(__dirname, '../../../../research/cmc-bot-vwap/fixtures/parity');
const SYMBOLS = ['US100', 'US500', 'EURCHF', 'GBPCHF'] as const;

// architecture/vwap-band-reversal-plugin.md §7 — the pinned parameters, identical across all
// four instruments except the (per-instrument, out of scope here) entry window.
const PARAMS = {
  minVwapAtrRatio: 2.5,
  maxVwapAtrRatio: 11.5,
  maxIfvgToAtrRatio: 8,
  targetRr: 3,
  rangeBars: 200,
  atrBars: 20,
};
const MAIN_WINDOW_MINUTES = 720;

interface EvalRow {
  T: number;
  n: number;
  err: boolean;
  rangeTop?: number | null;
  rangeBottom?: number | null;
  inDiscount: boolean;
  bullOcc: boolean;
  bearOcc: boolean;
  nBullIfvg: number;
  nBearIfvg: number;
  hasIfvg: boolean;
  ifvgLow?: number | null;
  ifvgHigh?: number | null;
  atr?: number | null;
  prevFound: boolean;
  prevHigh?: number | null;
  prevLow?: number | null;
  nBias: number;
  vwap?: number | null;
  vwapTop?: number | null;
  vwapBottom?: number | null;
  hi6?: number | null;
  lo6?: number | null;
  bias: 'sell' | 'buy' | null;
  vwapAtrRatio?: number | null;
  ifvgGate: boolean;
  aboveHi: boolean;
  belowLo: boolean;
  sell: boolean;
  buy: boolean;
  stop?: number | null;
  target?: number | null;
}

const BOOLEAN_FIELDS = [
  'err',
  'inDiscount',
  'bullOcc',
  'bearOcc',
  'hasIfvg',
  'prevFound',
  'ifvgGate',
  'aboveHi',
  'belowLo',
  'sell',
  'buy',
] as const;

const INT_FIELDS = ['n', 'nBullIfvg', 'nBearIfvg', 'nBias'] as const;

const FLOAT_FIELDS = [
  'rangeTop',
  'rangeBottom',
  'ifvgLow',
  'ifvgHigh',
  'atr',
  'prevHigh',
  'prevLow',
  'vwap',
  'vwapTop',
  'vwapBottom',
  'hi6',
  'lo6',
  'vwapAtrRatio',
  'stop',
  'target',
] as const;

function assertFloatEqual(actual: number | undefined, expected: number | null | undefined, field: string, T: number) {
  if (expected === null || expected === undefined) {
    expect([undefined, null].includes(actual as never)).toBe(true);
    return;
  }
  expect(actual).not.toBeUndefined();
  const tolerance = 1e-9 * Math.max(1, Math.abs(expected));
  const delta = Math.abs((actual as number) - expected);
  if (delta > tolerance) {
    throw new Error(`field '${field}' at T=${T}: expected ${expected}, got ${actual} (delta ${delta} > tolerance ${tolerance})`);
  }
}

function assertEvaluationMatches(actual: Evaluation, expected: EvalRow) {
  for (const field of BOOLEAN_FIELDS) {
    expect(actual[field]).toBe(expected[field]);
  }
  for (const field of INT_FIELDS) {
    expect(actual[field]).toBe(expected[field]);
  }
  for (const field of FLOAT_FIELDS) {
    assertFloatEqual(actual[field] as number | undefined, expected[field], field, expected.T);
  }
  expect(actual.bias).toBe(expected.bias);
}

function readJsonl<T>(filePath: string): T[] {
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

describe('vwap-band-reversal parity against the Researcher TS<->Python reproduction (architecture/vwap-band-reversal-plugin.md §5.3)', () => {
  if (!fs.existsSync(FIXTURES_ROOT)) {
    // eslint-disable-next-line no-console
    console.warn(
      '\n[vwap-band-reversal parity] SKIPPED: no fixture directory at ' +
        `${FIXTURES_ROOT}.\n` +
        'This is EXPECTED until the Researcher exports research/cmc-bot-vwap/fixtures/parity/<SYMBOL>/{candles,evals}.jsonl ' +
        'at Stage-0 close-out (architecture/vwap-band-reversal-plugin.md §5.3, §8.3). ' +
        'The parity test itself is written and ready to run against that format — see this file.\n',
    );
    it.skip('SKIPPED — parity fixture not present (see console warning above)', () => {});
    return;
  }

  for (const symbol of SYMBOLS) {
    const dir = path.join(FIXTURES_ROOT, symbol);
    const candlesPath = path.join(dir, 'candles.jsonl');
    const evalsPath = path.join(dir, 'evals.jsonl');

    if (!fs.existsSync(candlesPath) || !fs.existsSync(evalsPath)) {
      // eslint-disable-next-line no-console
      console.warn(`\n[vwap-band-reversal parity] SKIPPED for ${symbol}: missing candles.jsonl or evals.jsonl in ${dir}.\n`);
      it.skip(`SKIPPED — ${symbol} fixture incomplete`, () => {});
      continue;
    }

    it(`matches engine.py's COMP vector bar-for-bar for ${symbol}`, () => {
      const candles = readJsonl<Candle>(candlesPath);
      const evals = readJsonl<EvalRow>(evalsPath);
      expect(evals.length).toBeGreaterThan(0);

      const instrument = candles[0]?.instrument as InstrumentId;
      const cache = new CandleCache();
      cache.setMinDepth(instrument, '1m', 1440);
      for (const candle of candles) cache.upsert(candle);

      for (const row of evals) {
        const bars = cache.window(instrument, '1m');
        const { mainWindow, biasWindow } = sliceWindows(bars, row.T, MAIN_WINDOW_MINUTES);
        const out = evaluate(mainWindow, biasWindow, row.T, PARAMS);
        assertEvaluationMatches(out, row);
      }
    });
  }
});

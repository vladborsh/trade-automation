import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Candle, InstrumentId, TIMEFRAME_MS, Timeframe } from '@trade-automation/contracts';
import { FileCandleStore } from '../../src/storage/file/file-candle-store';

export const MIN = 60_000;
export const H = 60 * MIN;
export const DAY = 24 * H;
export const INSTRUMENT: InstrumentId = 'binance:BTCUSDT';

/** A deterministic, non-trivial 1m candle (prices vary so a wrong fold shows up). */
export function oneMinute(openTime: number, instrument: InstrumentId = INSTRUMENT): Candle {
  const i = openTime / MIN;
  const base = 100 + (i % 97) * 0.25 + Math.sin(i / 7) * 3;
  return {
    instrument,
    timeframe: '1m',
    openTime,
    open: base,
    high: base + 1 + (i % 5) * 0.1,
    low: base - 1 - (i % 3) * 0.1,
    close: base + ((i % 11) - 5) * 0.05,
    volume: 1 + (i % 13),
    closed: true,
    source: 'venue-rest',
  };
}

export function oneMinuteRange(from: number, to: number, instrument: InstrumentId = INSTRUMENT): Candle[] {
  const out: Candle[] = [];
  for (let t = from; t < to; t += MIN) out.push(oneMinute(t, instrument));
  return out;
}

/** A plain persisted `tf` bar, distinguishable from any fold by its OHLC. */
export function persistedBar(tf: Timeframe, openTime: number, source: Candle['source']): Candle {
  return {
    instrument: INSTRUMENT,
    timeframe: tf,
    openTime,
    open: 1,
    high: 2,
    low: 0.5,
    close: openTime / TIMEFRAME_MS[tf],
    volume: 7,
    closed: true,
    source,
  };
}

export function tempStore(): { store: FileCandleStore; root: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-server-replay-'));
  return { store: new FileCandleStore(root), root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

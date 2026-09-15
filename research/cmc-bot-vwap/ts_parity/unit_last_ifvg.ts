/**
 * D-03 unit check, run against the bot's unmodified calculateFVG: is
 * `lastIFVG` undefined whenever EITHER iFVG list is empty (the reading in
 * knowledge/smart-money-ict.md §1.3 / vwap-band-reversal-ict.md §3), or only
 * when the BULLISH list is empty (the literal reading of getLastIfvg)?
 */
import { calculateFVG } from '../../../cmc-bot-main/src/indicator/tools/fvg.indicator';
const C = (o: number, h: number, l: number, c: number, i: number) => ({ openTime: i * 60000, open: o, high: h, low: l, close: c, volume: 1 });
// bearish FVG at bar 3 (low 97, high 99), closed back above 99 on bar 4 -> ONE bullish iFVG, zero bearish iFVGs
const up = [C(100, 101, 99, 100, 0), C(100, 101, 99, 100, 1), C(98, 98.5, 96, 97, 2), C(96, 97, 95, 95.5, 3), C(98, 100, 97.5, 99.5, 4)];
// the exact mirror: bullish FVG at bar 3 (low 101, high 103), closed back below 101 on bar 4 -> ONE bearish iFVG, zero bullish
const dn = up.map((k, i) => C(200 - k.open, 200 - k.low, 200 - k.high, 200 - k.close, i));
for (const [name, cs] of [['bullish-only', up], ['bearish-only', dn]] as const) {
  const r = calculateFVG(cs as any);
  console.log(JSON.stringify({ case: name, nBullishIFVG: r.bullishIFVGs.length, nBearishIFVG: r.bearishIFVGs.length, lastIFVG: r.lastIFVG ?? 'undefined', lastIFVGDirection: r.lastIFVGDirection }));
}

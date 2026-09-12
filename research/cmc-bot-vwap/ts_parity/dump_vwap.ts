/**
 * Stage-0 parity harness — the TypeScript side, for `VWapStrategy`.
 *
 * `npm run backtest ... vwap <static json>` cannot run here for the same
 * infrastructural reasons the smart-money pass recorded (BacktestRunner.init()
 * builds a native-`canvas` ChartCanvasRenderer and an AWS-backed DynamicConfig;
 * the reporter renders PNGs) — none of it touches signal generation. So this
 * file reproduces `BacktestRunner.runTests`'s bar loop verbatim
 * (backtest-runner.ts:66-79):
 *
 *     requestStartTime = time - 12h ; requestEndTime = time ; step = 1 minute
 *
 * and imports every line under test UNMODIFIED from cmc-bot-main/src/:
 * StaticDataSource, VWapStrategy, StrategyTemplate, RiskManager, Order, VWAP,
 * calculateFVG / fvg-element, range, ATR, previousHourLH, composeIndicators.
 * `hyperParameters` are passed exactly as `StrategyProvider` builds them
 * (strategy-provider.ts), with the US100/US500 timings the user specified
 * (ARCHITECT-NOTE §4) in place of the S3 `FOREX_TIMINGS` object.
 *
 * Two event streams, one JSON object per line:
 *   {"ev":"signal"|"close"|"trail"|"error", ...}   the strategy's own lifecycle
 *   {"ev":"eval", t, ...}                           for every minute where
 *     isValidTimeForNewOrders(t) is true: every intermediate value processCharts
 *     reads, obtained by calling the strategy's OWN private methods
 *     (processCandles, getHighTimeFrameBias, isIFVGtoATRRatioAllowed,
 *     abovePrevHourHigh, belowPrevHourLow) on the same windows, plus VWAP() on
 *     the bias window for the band values getHighTimeFrameBias does not return
 *     when price is inside the band. These are pure functions of the windows;
 *     calling them does not touch strategy state.
 *
 *   cd cmc-bot-main && TZ=UTC NODE_PATH=../research/cmc-bot-vwap/ts_harness/node_modules \
 *     ../research/cmc-bot-vwap/ts_harness/node_modules/.bin/ts-node --transpile-only \
 *     ../research/cmc-bot-vwap/ts_parity/dump_vwap.ts <startISO> <endISO> <SYMBOL> <m1.json> > events.jsonl
 */
import 'reflect-metadata';
import { add, startOfDay } from 'date-fns';

import { StaticDataSource } from '../../../cmc-bot-main/src/backtesting/static-data-source';
import { VWapStrategy } from '../../../cmc-bot-main/src/strategy/vwap-strategy';
import { RiskManager } from '../../../cmc-bot-main/src/strategy/risk-manager';
import { OrderDirection } from '../../../cmc-bot-main/src/strategy/enum/order-direction.enum';
import { GeneralTimeIntervals } from '../../../cmc-bot-main/src/types/enums';
import { VWAP } from '../../../cmc-bot-main/src/indicator/tools/vwap.indicator';

const [startArg, endArg, symbol, files] = process.argv.slice(2);

const ratios = { MIN_VWAP_ATR_RATIO: 2.5, MAX_VWAP_ATR_RATIO: 11.5, MAX_IFVG_TO_ATR_RATIO: 8 };
const HYPER: Record<string, Record<string, any>> = {
  // user-specified provisional windows (ARCHITECT-NOTE §4), same for both indices
  US100: { timings: [[{ hour: 9, minute: 40 }, { hour: 11, minute: 40 }]], orderAliveTimings: [[{ hour: 9, minute: 40 }, { hour: 14, minute: 30 }]], ...ratios },
  US500: { timings: [[{ hour: 9, minute: 40 }, { hour: 11, minute: 40 }]], orderAliveTimings: [[{ hour: 9, minute: 40 }, { hour: 14, minute: 30 }]], ...ratios },
  // strategy-provider.ts:51-62, :74-85, verbatim
  EURCHF: { timings: [[{ hour: 3, minute: 2 }, { hour: 3, minute: 20 }]], orderAliveTimings: [[{ hour: 3, minute: 0 }, { hour: 4, minute: 0 }]], ...ratios },
  GBPCHF: { timings: [[{ hour: 3, minute: 3 }, { hour: 3, minute: 20 }]], orderAliveTimings: [[{ hour: 3, minute: 0 }, { hour: 5, minute: 0 }]], ...ratios },
};

const num = (x: any) => (typeof x === 'number' && Number.isFinite(x) ? x : x === Infinity ? 'inf' : x === -Infinity ? '-inf' : null);

async function main() {
  const source = new StaticDataSource(files.split(','));
  await source.init();
  const strategy = new VWapStrategy(source as any, symbol, symbol.toLowerCase(), HYPER[symbol], new RiskManager());
  const S = strategy as any;
  const emit = (o: Record<string, unknown>) => process.stdout.write(JSON.stringify(o) + '\n');

  strategy.onOrderClosedByPrice$.subscribe(({ order, status }) =>
    emit({ ev: 'close', why: status, id: order.id, closeTime: order.closeTime, closePrice: order.closePrice, stop: order.stopLossPrice }));
  strategy.onOrderClosedByStrategy$.subscribe(order =>
    emit({ ev: 'close', why: 'STRATEGY', id: order.id, closeTime: order.closeTime, closePrice: order.closePrice, stop: order.stopLossPrice }));
  strategy.onTrailStopLoss$.subscribe(order => emit({ ev: 'trail', id: order.id, stop: order.stopLossPrice }));

  let time = new Date(startArg);
  const endTime = new Date(endArg);

  while (time <= endTime) {
    const requestStartTime = add(time, { hours: -12 }).getTime();
    const requestEndTime = time.getTime();

    if (strategy.isValidTimeForNewOrders(requestEndTime)) {
      try {
        const candles = await source.getCandles(symbol, GeneralTimeIntervals.m1, requestStartTime, requestEndTime);
        const rec: Record<string, unknown> = { ev: 'eval', t: requestEndTime, n: candles.length };
        if (candles.length) {
          const last = candles[candles.length - 1];
          rec.g_ts = last.openTime; rec.s_ts = candles[0].openTime;
          const r = S.processCandles(candles);
          rec.range_top = num(r.range.top[r.range.top.length - 1]);
          rec.range_bottom = num(r.range.bottom[r.range.bottom.length - 1]);
          rec.in_disc = r.range.priceInDiscount;
          rec.bull_occ = r.fvg.bullishIfvgOccurs; rec.bear_occ = r.fvg.bearishIfvgOccurs;
          rec.has_ifvg = !!r.fvg.lastIFVG;
          rec.ifvg_low = r.fvg.lastIFVG ? r.fvg.lastIFVG.low : null;
          rec.ifvg_high = r.fvg.lastIFVG ? r.fvg.lastIFVG.high : null;
          rec.n_bull_ifvg = r.fvg.bullishIFVGs.length; rec.n_bear_ifvg = r.fvg.bearishIFVGs.length;
          rec.atr = num(r.atr[r.atr.length - 1]);
          rec.prev_found = !!r.prevHour;
          rec.prev_high = r.prevHour ? r.prevHour.high.y : null;
          rec.prev_low = r.prevHour ? r.prevHour.low.y : null;
          const biasStart = add(startOfDay(requestEndTime), { minutes: 1 }).getTime();   // vwap-strategy.ts:272
          const bc = await source.getCandles(symbol, GeneralTimeIntervals.m1, biasStart, requestEndTime);
          rec.n_bias = bc.length;
          if (bc.length) {
            const vw = VWAP(bc);
            rec.vwap = num(vw.vwap[vw.vwap.length - 1]);
            rec.vwap_top = num(vw.vwapTop[vw.vwapTop.length - 1]);
            rec.vwap_bottom = num(vw.vwapBottom[vw.vwapBottom.length - 1]);
          }
          const bias = await S.getHighTimeFrameBias(last.open, requestEndTime);
          rec.bias = bias ? (bias.direction === OrderDirection.buy ? 'buy' : 'sell') : null;
          rec.ifvg_ok = S.isIFVGtoATRRatioAllowed(candles, r.fvg.lastIFVG);
          rec.above = S.abovePrevHourHigh(candles, r.prevHour?.high);
          rec.below = S.belowPrevHourLow(candles, r.prevHour?.low);
        }
        emit(rec);
      } catch (e: any) {
        emit({ ev: 'eval', t: requestEndTime, error: String(e?.message || e) });
      }
    }

    try {
      const { order } = await strategy.processStep(requestStartTime, requestEndTime);
      if (order) {
        emit({ ev: 'signal', id: order.id, t: requestEndTime, dir: order.direction === OrderDirection.buy ? 'buy' : 'sell',
               entry: order.entryPrice, entryTime: order.entryTime, stop: order.stopLossPrice, target: order.takeProfitPrice });
      }
    } catch (e: any) {
      emit({ ev: 'error', t: requestEndTime, error: String(e?.message || e) });
    }
    time = add(time, { minutes: 1 });
  }
  const open = (S.orders as any[]).filter(o => !o.isClosed).length;
  emit({ ev: 'end', orders: S.orders.length, open });
}

main().then(() => process.exit(0));

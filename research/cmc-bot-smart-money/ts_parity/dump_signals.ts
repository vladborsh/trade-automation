/**
 * Stage-0 parity harness — the TypeScript side.
 *
 * WHY THIS FILE EXISTS instead of `npm run backtest`:
 * `BacktestRunner.init()` constructs a `ChartCanvasRenderer` (native `canvas`
 * bindings), an `EnvConfig` and a `DynamicConfig` (AWS SSM / `.env`), and
 * `BacktestReporter.generateReport()` renders PNGs — none of which exist or can
 * be reached from this research environment, and none of which touch signal
 * generation. This file reproduces `BacktestRunner.runTests`'s **bar loop
 * verbatim** (backtest-runner.ts:64-79) and nothing else:
 *
 *     requestStartTime = time - 12h ; requestEndTime = time ; step = 1 minute
 *
 * Every line of logic under test — `StaticDataSource`, `SmartMoneyStrategy`,
 * `StrategyTemplate`, `RiskManager`, `Order`, `indicatorScript`, `FvgCalculator`,
 * `Swings`, `YinDiscount`, `ATR`, the date helpers — is the bot's own,
 * **unmodified**, imported straight out of `cmc-bot-main/src/`. Nothing in
 * `cmc-bot-main/` is edited by this pass.
 *
 * It emits one JSON line per event so the Python port can be diffed against it:
 *   {"ev":"signal", ...}  an order was created (entry/stop/target)
 *   {"ev":"close",  ...}  an order was closed (by price, by the both-directions
 *                         rule, or by the forced flat outside the session)
 *   {"ev":"trail",  ...}  a stop was moved by `tryToTrailStopLoss`
 *
 * Run (TZ=UTC is the pinned host assumption — knowledge/smart-money-ict.md §2):
 *   cd cmc-bot-main
 *   TZ=UTC NODE_PATH=$PWD/node_modules npx ts-node --transpile-only \
 *     ../research/cmc-bot-smart-money/ts_parity/dump_signals.ts \
 *     <startISO> <endISO> <SYMBOL> <m1.json,h1.json>
 */
import { add } from 'date-fns';

import { StaticDataSource } from '../../../cmc-bot-main/src/backtesting/static-data-source';
import { SmartMoneyStrategy } from '../../../cmc-bot-main/src/strategy/smartmoney-strategy';
import { RiskManager } from '../../../cmc-bot-main/src/strategy/risk-manager';
import { OrderDirection } from '../../../cmc-bot-main/src/strategy/enum/order-direction.enum';

const [startArg, endArg, symbol, files] = process.argv.slice(2);

async function main() {
  const source = new StaticDataSource(files.split(','));
  await source.init();

  const strategy = new SmartMoneyStrategy(
    source as any, symbol, symbol.toLowerCase(), new RiskManager());

  const emit = (o: Record<string, unknown>) => process.stdout.write(JSON.stringify(o) + '\n');

  strategy.onOrderClosedByPrice$.subscribe(({ order, status }) =>
    emit({ ev: 'close', why: status, id: order.id, closeTime: order.closeTime,
           closePrice: order.closePrice, stop: order.stopLossPrice }));
  strategy.onOrderClosedByStrategy$.subscribe(order =>
    emit({ ev: 'close', why: 'STRATEGY', id: order.id, closeTime: order.closeTime,
           closePrice: order.closePrice, stop: order.stopLossPrice }));
  strategy.onTrailStopLoss$.subscribe(order =>
    emit({ ev: 'trail', id: order.id, stop: order.stopLossPrice }));

  let time = new Date(startArg);
  const endTime = new Date(endArg);

  while (time <= endTime) {
    // backtest-runner.ts:69-72, verbatim
    const requestStartTime = add(time, { hours: -12 }).getTime();
    const requestEndTime = time.getTime();
    const { order } = await strategy.processStep(requestStartTime, requestEndTime);

    if (order) {
      emit({
        ev: 'signal',
        id: order.id,
        t: requestEndTime,                      // the signal bar's openTime
        dir: order.direction === OrderDirection.buy ? 'buy' : 'sell',
        entry: order.entryPrice,
        entryTime: order.entryTime,
        stop: order.stopLossPrice,
        target: order.takeProfitPrice,
      });
    }
    time = add(time, { minutes: 1 });
  }
}

main().then(() => process.exit(0));

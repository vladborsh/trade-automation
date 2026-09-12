

import { isValidIntervalType } from "./cli-helpers";
import { BacktestRunner } from "../backtest-runner";
import { StaticDataSource } from "../static-data-source";
import { getStrategyFactoryByKey } from "../backtest-helpers";

const args = process.argv.slice(2);

const startDate = args[0];
const endDate = args[1];
const interval = args[2];
const symbol = args[3];
const strategy = args[4];
const staticSource = args[5] ? args[5].split(',') : null;

if (!isValidIntervalType(interval)) {
  throw new Error(`Invalid interval type: ${interval}`);
}

const runner = new BacktestRunner(
  new Date(startDate),
  new Date(endDate),
  interval,
  staticSource ? () => new StaticDataSource(staticSource) : undefined
);

runner.runTests(symbol, strategy);


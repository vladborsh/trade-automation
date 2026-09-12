import { DataScrapper } from "../data-scrapper";
import { isValidIntervalType } from "./cli-helpers";

const args = process.argv.slice(2);

const startDate = args[0];
const endDate = args[1];
const interval = args[2];
const symbol = args[3];
const isForex = args[4];

if (!isValidIntervalType(interval)) {
  throw new Error(`Invalid interval type: ${interval}`);
}

new DataScrapper(new Date(startDate), new Date(endDate), interval)
  .scrap(symbol, !!isForex);


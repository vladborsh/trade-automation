import { GeneralTimeIntervals } from "../types/enums";
import { getLinkText } from "./get-link-text.helper";
import { MappedListing } from "../interfaces/mapped-listing.interface";

export function processDayTradingSelectionForMessage(selection: MappedListing[]) {
  return selection.reduce((res, listing, i) => {
    return res
      .concat(`\n \\#${i + 1}: __ *${getLinkText(`${listing.symbol}USDT`, GeneralTimeIntervals.h1)}* __ \\(${prepareString(listing.name)}\\)`)
      .concat(`\n \\- Capital: ${prepareString(listing.marketCap)}`)
      .concat(`\n \\- Volume 24h: ${prepareString(listing.volume24h)}`)
      .concat(`\n \\- Volume change 24h: ${prepareString(listing.volumeChange24h)}%`)
      .concat(`\n \\- Price change 7d: ${prepareString(listing.priceChange7d)}%`)
      .concat(`\n \\- Price change 24h: ${prepareString(listing.priceChange24h)}%`)
      .concat(`\n`);
  }, 'Day trading selection: \n');
}

export function getMessageForSelection(listing: MappedListing): string {
  return ''
    .concat(`\n \\ __ *${getLinkText(`${listing.symbol}USDT`, GeneralTimeIntervals.h1)}* __ ${prepareString(listing.name)}`)
    .concat(`\n \\- Capital: ${prepareString(listing.marketCap)}`)
    .concat(`\n \\- Volume 24h ratio: ${prepareString(listing.cap2volume7dRatio.toFixed(2).toString())}`)
    .concat(`\n \\- Volume 7d ratio: ${prepareString(listing.cap2volume24hRatio.toFixed(2).toString())}`);
}

export function prepareString(str: string): string {
  return str
    .replace(/\-/g, '\\-')
    .replace(/\./g, '\\.')
    .replace(/\!/g, '\\!')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\#/g, '\\#')
    .replace(/\=/g, '\\=');
}

export const chop = (str: string): string => str.substring(0, str.length - 1);


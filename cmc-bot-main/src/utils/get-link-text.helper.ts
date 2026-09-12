export function getLinkText(asset: string, timeFrame: string, exchange = 'BINANCE'): string {
  const url = `https://www.tradingview.com/chart/?symbol=${exchange}:${asset}`;
  const message = `[${asset.toUpperCase()}](${url})`;

  return message;
}

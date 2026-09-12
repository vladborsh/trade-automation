import { CMCListingInfo } from '../interfaces/cmc-listing-info.interface';
import { DynamicConfigValues } from '../interfaces/dynamic-config.interface';
import { MappedListing } from '../interfaces/mapped-listing.interface';
import { BotCommands } from '../types/enums';

interface NormalizedBy<T> {
  item: T;
  normMarketCap: number;
  normVolume24h: number;
  normVolume7d: number;
}

function maxBy(arr: MappedListing[], key: 'cap2volume7dRatio' | 'cap2volume24hRatio' | 'marketCapValue'): number {
  let max: number = 0;

  for (const item of arr) {
    if (item[key] > max) {
      max = item[key];
    }
  }

  return max;
}

function normalize(arr: MappedListing[]): NormalizedBy<MappedListing>[] {
  const maxMarketCap = maxBy(arr, 'marketCapValue');
  const maxVolume24h = maxBy(arr, 'cap2volume24hRatio');
  const maxVolume7d = maxBy(arr, 'cap2volume7dRatio');

  return arr.map(item => ({
    item,
    normMarketCap: item.marketCapValue / maxMarketCap,
    normVolume24h: item.cap2volume24hRatio / maxVolume24h,
    normVolume7d: item.cap2volume7dRatio / maxVolume7d,
  }));
}

function normalizedSort(arr: NormalizedBy<MappedListing>[]) {
  arr.sort((a, b) => {
    return (b.normMarketCap + b.normVolume24h + b.normVolume7d)
      - (a.normMarketCap + a.normVolume24h + a.normVolume7d)
  });

  return arr;
}

export class MarketDataMapper {
  constructor(private config: DynamicConfigValues) {}

  public filterAndSortCoins(data: CMCListingInfo[], commandText: BotCommands): MappedListing[] {
    const filteredListings = data.filter(
      (listing) =>
        !this.config.OMIT_TOKENS.includes(listing.symbol) &&
        listing.quote.USD.volume_24h > this.config.MIN_DAILY_VOLUME &&
        (listing.quote.USD.volume_24h / listing.quote.USD.market_cap) > 0.08 &&
        !listing.tags?.includes('stablecoin')
    );

    const mappedList = filteredListings.map<MappedListing>((listing) => ({
      name: listing.name,
      symbol: listing.symbol,
      marketCap: this.formatCurrency(Math.floor(listing.quote.USD.market_cap), 'USD'),
      priceChange7d: listing.quote.USD.percent_change_7d.toFixed(2).toString(),
      priceChange24h: listing.quote.USD.percent_change_24h.toFixed(2).toString(),
      volume24h: this.formatCurrency(Math.floor(listing.quote.USD.volume_24h), 'USD'),
      volumeChange24h: listing.quote.USD.volume_change_24h.toFixed(2).toString(),
      cap2volume7dRatio: listing.quote.USD.volume_7d / listing.quote.USD.market_cap,
      cap2volume24hRatio: listing.quote.USD.volume_24h / listing.quote.USD.market_cap,
      marketCapValue: listing.quote.USD.market_cap,
      listing,
    }));

    const result = normalizedSort(normalize(mappedList)).map(el => el.item);

    return result.slice(0, this.config.SELECTION_NUMBER);
  }

  private formatCurrency(num: number, currencyCode: string) {
    return num.toLocaleString('en-US', {
      style: 'currency',
      currency: currencyCode,
    });
  }
}

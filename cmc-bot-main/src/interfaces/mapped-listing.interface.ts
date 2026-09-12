import { CMCListingInfo } from "./cmc-listing-info.interface";

export interface MappedListing {
  name: string;
  marketCap: string;
  symbol: string;
  priceChange7d: string;
  priceChange24h: string;
  volume24h: string;
  volumeChange24h: string;
  cap2volume7dRatio: number;
  cap2volume24hRatio: number;
  marketCapValue: number;
  listing: CMCListingInfo,
}

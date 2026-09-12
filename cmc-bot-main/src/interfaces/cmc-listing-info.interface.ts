export interface CMCListingInfo {
  id: number;
  symbol: string;
  name: string;
  tags?: string[];
  quote: {
    USD: {
      percent_change_24h: number;
      percent_change_7d: number;
      percent_change_30d: number;
      percent_change_60d: number;
      percent_change_90d: number;
      price: number;
      volume_change_24h: number;
      volume_24h: number;
      volume_7d: number;
      market_cap: number;
    }
  }
}

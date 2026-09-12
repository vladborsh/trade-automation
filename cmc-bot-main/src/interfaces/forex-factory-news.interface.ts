export interface ForexFactoryNews {
  title: string;
  country: NewsCountryType;
  date: string;
  impact: NewsImpactType;
  forecast: string;
  previous: string;
}

export enum NewsImpactType {
  LOW = 'Low',
  MEDIUM = 'Medium',
  HIGH = 'High',
  HOLIDAY = 'Holiday',
}

export enum NewsCountryType {
  USD = 'USD',
  EUR = 'EUR',
  GBP = 'GBP',
  JPY = 'JPY',
  AUD = 'AUD',
  CAD = 'CAD',
  CHF = 'CHF',
  CNY = 'CNY',
  NZD = 'NZD',
}

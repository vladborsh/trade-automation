import { Indicator } from "../interfaces/indicator.interface";

export type Nullable<T> = T | null;

export type IndicatorMap<T extends readonly Indicator[]> = {
  [K in T[number] as K['code']]: ReturnType<K['calculate']>;
};

import { CandleChartData } from "./candlestick-chart-data";
import { Subject, Observable } from 'rxjs';

export interface SymbolState {
  symbol: string;
  history: CandleChartData[];
  stream$: Observable<CandleChartData[]>;
  onTerminate$: Subject<void>;
}

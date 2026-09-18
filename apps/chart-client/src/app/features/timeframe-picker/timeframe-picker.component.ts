import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TimeframeStore } from '../../core/state/timeframe.store';
import type { Timeframe } from '@trade-automation/contracts';

const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

@Component({
  selector: 'app-timeframe-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './timeframe-picker.component.html',
  styleUrl: './timeframe-picker.component.scss',
})
export class TimeframePickerComponent {
  readonly timeframes = TIMEFRAMES;
  constructor(readonly store: TimeframeStore) {}
}

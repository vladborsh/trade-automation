import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TimeframeStore } from '../../core/state/timeframe.store';
import type { Timeframe } from '../../core/contracts/contracts';

const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

@Component({
  selector: 'app-timeframe-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="picker">
      @for (tf of timeframes; track tf) {
        <button
          type="button"
          class="tf-btn"
          [class.active]="tf === store.selected()"
          (click)="store.select(tf)"
        >
          {{ tf }}
        </button>
      }
    </div>
  `,
  styles: [
    `
      .picker {
        display: flex;
        gap: 2px;
      }
      .tf-btn {
        background: #0d1117;
        color: #8b949e;
        border: 1px solid #30363d;
        font-family: inherit;
        font-size: 12px;
        padding: 3px 8px;
        cursor: pointer;
      }
      .tf-btn:hover {
        color: #c9d1d9;
      }
      .tf-btn.active {
        background: #21262d;
        color: #58a6ff;
        border-color: #58a6ff;
      }
    `,
  ],
})
export class TimeframePickerComponent {
  readonly timeframes = TIMEFRAMES;
  constructor(readonly store: TimeframeStore) {}
}

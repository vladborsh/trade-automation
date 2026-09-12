import { ChangeDetectionStrategy, Component, ElementRef, computed, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InstrumentsStore } from '../../core/state/instruments.store';
import type { InstrumentWithStatus } from '../../core/contracts/contracts';

@Component({
  selector: 'app-instrument-switcher',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="switcher">
      <input
        #searchInput
        class="switcher-input"
        type="text"
        placeholder="instrument (/)"
        [(ngModel)]="query"
        (focus)="open.set(true)"
        (blur)="onBlur()"
      />
      @if (open()) {
        <ul class="switcher-list">
          @for (instrument of filtered(); track instrument.id) {
            <li>
              <button type="button" (mousedown)="select(instrument)">
                <span class="id">{{ instrument.id }}</span>
                <span class="status" [class]="'status-' + instrument.venueStatus">{{ instrument.venueStatus }}</span>
              </button>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: [
    `
      .switcher {
        position: relative;
        font-family: inherit;
      }
      .switcher-input {
        background: #0d1117;
        color: #c9d1d9;
        border: 1px solid #30363d;
        padding: 4px 8px;
        font-family: inherit;
        font-size: 13px;
        width: 220px;
      }
      .switcher-input:focus {
        outline: 1px solid #58a6ff;
      }
      .switcher-list {
        position: absolute;
        top: 100%;
        left: 0;
        width: 260px;
        max-height: 240px;
        overflow-y: auto;
        background: #161b22;
        border: 1px solid #30363d;
        margin: 2px 0 0;
        padding: 0;
        list-style: none;
        z-index: 20;
      }
      .switcher-list button {
        display: flex;
        justify-content: space-between;
        width: 100%;
        background: none;
        border: none;
        color: #c9d1d9;
        font-family: inherit;
        font-size: 12px;
        padding: 4px 8px;
        cursor: pointer;
        text-align: left;
      }
      .switcher-list button:hover {
        background: #21262d;
      }
      .status {
        font-size: 10px;
        opacity: 0.8;
      }
      .status-up {
        color: #26a69a;
      }
      .status-degraded {
        color: #d29922;
      }
      .status-down,
      .status-closed {
        color: #ef5350;
      }
    `,
  ],
})
export class InstrumentSwitcherComponent {
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  readonly query = signal('');
  readonly open = signal(false);

  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const all = this.store.instruments();
    if (!q) {
      return all;
    }
    return all.filter((i) => i.id.toLowerCase().includes(q) || i.displayName.toLowerCase().includes(q));
  });

  constructor(private readonly store: InstrumentsStore) {}

  select(instrument: InstrumentWithStatus): void {
    this.store.select(instrument.id);
    this.query.set('');
    this.open.set(false);
  }

  onBlur(): void {
    // let a mousedown-selected click land before we collapse the list
    setTimeout(() => this.open.set(false), 100);
  }

  focusInput(): void {
    this.searchInput()?.nativeElement.focus();
  }
}

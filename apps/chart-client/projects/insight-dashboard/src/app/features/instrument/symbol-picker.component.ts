import {
  ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, signal, viewChild,
} from '@angular/core';
import type { WebUniverseSummaryRow, WebUniverseSymbol } from '@trade-automation/contracts';
import { I18nService } from '../../i18n/i18n.service';
import { coinPrice } from '../market/market.adapter';
import { signed } from '../market/market.format';
import { enterTarget, pickerRows } from './symbol-picker.rows';

/**
 * The instrument page's symbol dropdown (2026-10-24; it replaced the always-visible chip strip,
 * which the user found took room from the chart).
 *
 * The list is the top 20 by volume; each row carries the coin's 24 h price change, predicted
 * funding and 24 h open-interest change from `/universe/summary`. The parent loads the summary
 * when the dropdown opens (`opened`), so the figures are at most a minute old when read.
 * Typing filters; Enter opens the only match, or the typed symbol when it is outside the top 20.
 */
@Component({
  selector: 'app-symbol-picker',
  standalone: true,
  templateUrl: './symbol-picker.component.html',
  styleUrl: './symbol-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SymbolPickerComponent {
  readonly symbol = input.required<string>();
  readonly universe = input<readonly WebUniverseSymbol[]>([]);
  readonly summary = input<readonly WebUniverseSummaryRow[] | null>(null);
  readonly summaryFailed = input(false);

  readonly selected = output<string>();
  readonly opened = output<void>();

  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);
  private readonly root = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly search = viewChild<ElementRef<HTMLInputElement>>('search');

  readonly open = signal(false);
  readonly query = signal('');

  readonly rows = computed(() => pickerRows(this.universe(), this.summary(), this.query(), this.symbol()));

  /** The open symbol's own figures, for the button. */
  readonly current = computed(() => {
    const row = this.summary()?.find((r) => r.id === this.symbol()) ?? null;
    const change = row?.changePct24h ?? null;
    return { price: coinPrice(row?.lastPrice ?? null), change: signed(change, 2), changeSign: change === null ? null : Math.sign(change) };
  });

  toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }
    this.open.set(true);
    this.query.set('');
    this.opened.emit();
    setTimeout(() => this.search()?.nativeElement.focus());
  }

  close(): void {
    this.open.set(false);
  }

  choose(id: string): void {
    this.close();
    this.selected.emit(id);
  }

  enter(): void {
    const target = enterTarget(this.rows(), this.query());
    if (target) this.choose(target);
  }

  /** Closes when focus leaves the dropdown, so Tab away and a click elsewhere both close it. */
  onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (next && this.root.nativeElement.contains(next)) return;
    this.close();
  }
}

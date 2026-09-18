import { Injectable, computed, signal } from '@angular/core';
import { type RsiPrefs, commitRsiPeriod, isRsiVisible, parseRsiPrefs, withRsiVisible } from './rsi-prefs';

const RSI_KEY = 'chart-client:rsi';

/**
 * architecture/chart-layouts.md §12.4 — RSI pane preferences: one global period, visibility per
 * panel per layout, persisted in localStorage (same pattern as `CollapsedPanelsStore`). Reads are
 * plain methods over one signal, so they are reactive in a template/computed/effect.
 */
@Injectable({ providedIn: 'root' })
export class RsiPrefsStore {
  private readonly state = signal<RsiPrefs>(this.readStored());

  readonly period = computed(() => this.state().period);

  isVisible(layoutId: string, panelId: string): boolean {
    return isRsiVisible(this.state(), layoutId, panelId);
  }

  setVisible(layoutId: string, panelId: string, visible: boolean): void {
    this.write(withRsiVisible(this.state(), layoutId, panelId, visible));
  }

  /** Clamped to 2–100; a non-numeric value keeps the current period. */
  setPeriod(value: unknown): void {
    this.write({ ...this.state(), period: commitRsiPeriod(this.state().period, value) });
  }

  private write(next: RsiPrefs): void {
    this.state.set(next);
    try {
      localStorage.setItem(RSI_KEY, JSON.stringify(next));
    } catch {
      // localStorage unavailable — the preference still applies in-memory for this session
    }
  }

  private readStored(): RsiPrefs {
    try {
      return parseRsiPrefs(localStorage.getItem(RSI_KEY));
    } catch {
      return parseRsiPrefs(null);
    }
  }
}

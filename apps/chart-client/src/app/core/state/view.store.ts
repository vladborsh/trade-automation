import { Injectable, signal } from '@angular/core';

export type TerminalView = 'charts' | 'calendar';

const ACTIVE_VIEW_KEY = 'chart-client:active-view';

/**
 * §7 / D9 — the top-level charts⇄calendar view switch lives in the terminal
 * shell, not the router (there isn't one). One boolean of view state,
 * restored across reload like `LayoutsStore`'s active-layout id.
 */
@Injectable({ providedIn: 'root' })
export class ViewStore {
  private readonly view = signal<TerminalView>(this.readStoredView());

  readonly activeView = this.view.asReadonly();

  set(view: TerminalView): void {
    this.view.set(view);
    try {
      localStorage.setItem(ACTIVE_VIEW_KEY, view);
    } catch {
      // localStorage unavailable — the switch still works in-memory for this session
    }
  }

  toggle(): void {
    this.set(this.view() === 'charts' ? 'calendar' : 'charts');
  }

  private readStoredView(): TerminalView {
    try {
      const stored = localStorage.getItem(ACTIVE_VIEW_KEY);
      return stored === 'calendar' ? 'calendar' : 'charts';
    } catch {
      return 'charts';
    }
  }
}

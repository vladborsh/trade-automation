import { Injectable, signal } from '@angular/core';
import type { Layout } from '@trade-automation/contracts';
import {
  type CollapsedPanelsState,
  canCollapse,
  effectiveCollapsed,
  parseCollapsedPanels,
} from './collapsed-panels';

const COLLAPSED_KEY = 'chart-client:collapsed-panels';

/**
 * architecture/chart-layouts.md §11.3 — which panels of each layout are collapsed to a strip,
 * persisted per layout in localStorage (like the calendar filters). Reads are plain methods over
 * one signal, so they are reactive wherever they are called from a template/computed/effect.
 */
@Injectable({ providedIn: 'root' })
export class CollapsedPanelsStore {
  private readonly state = signal<CollapsedPanelsState>(this.readStored());

  /** The collapsed panel ids of `layout`, sanitised (see `effectiveCollapsed`). */
  collapsedIds(layout: Layout): string[] {
    return effectiveCollapsed(this.state()[layout.id], panelIdsOf(layout));
  }

  isCollapsed(layout: Layout, panelId: string): boolean {
    return this.collapsedIds(layout).includes(panelId);
  }

  /** False for the last expanded panel — its collapse button is disabled. */
  canCollapse(layout: Layout, panelId: string): boolean {
    return canCollapse(this.collapsedIds(layout), panelIdsOf(layout), panelId);
  }

  collapse(layout: Layout, panelId: string): void {
    if (!this.canCollapse(layout, panelId)) {
      return;
    }
    this.write(layout, [...this.collapsedIds(layout), panelId]);
  }

  expand(layout: Layout, panelId: string): void {
    const current = this.collapsedIds(layout);
    if (!current.includes(panelId)) {
      return;
    }
    this.write(
      layout,
      current.filter((id) => id !== panelId),
    );
  }

  private write(layout: Layout, collapsed: string[]): void {
    const next = {
      ...this.state(),
      [layout.id]: effectiveCollapsed(collapsed, panelIdsOf(layout)),
    };
    this.state.set(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
    } catch {
      // localStorage unavailable — collapse still works in-memory for this session
    }
  }

  private readStored(): CollapsedPanelsState {
    try {
      return parseCollapsedPanels(localStorage.getItem(COLLAPSED_KEY));
    } catch {
      return {};
    }
  }
}

function panelIdsOf(layout: Layout): string[] {
  return layout.panels.map((p) => p.id);
}

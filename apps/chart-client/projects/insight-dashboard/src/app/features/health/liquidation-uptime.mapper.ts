import type { WebLiquidationUptime, WebUptimeState, WebUptimeWindow } from '@trade-automation/contracts';
import type { StringKey } from '../../i18n/keys';

/**
 * WD-009 — the health page's liquidation-collector block, as pure functions (AGENTS.md: the
 * component is wiring only). The server decides the state; this only names and colours it.
 */
const STATE_KEY: Record<WebUptimeState, StringKey> = {
  recorded: 'health.uptime.state.recorded',
  no_events: 'health.uptime.state.no_events',
  not_recorded: 'health.uptime.state.not_recorded',
};

/** `ok` and `quiet` are both fine; only `missing` is a warning — liquidations may be absent. */
const STATE_CLASS: Record<WebUptimeState, 'ok' | 'quiet' | 'missing'> = {
  recorded: 'ok',
  no_events: 'quiet',
  not_recorded: 'missing',
};

export function uptimeStateKey(state: WebUptimeState): StringKey {
  return STATE_KEY[state];
}

export function uptimeStateClass(state: WebUptimeState): 'ok' | 'quiet' | 'missing' {
  return STATE_CLASS[state];
}

/** The 24 h and 7 d windows by length, so the table never depends on the server's order. */
export function windowOf(row: WebLiquidationUptime, hours: number): WebUptimeWindow | null {
  return row.windows.find((w) => w.hours === hours) ?? null;
}

/** Seconds since an epoch-ms instant, for the page's existing age formatter; null stays null. */
export function ageSec(epochMs: number | null, nowMs: number): number | null {
  return epochMs === null ? null : Math.max(0, Math.round((nowMs - epochMs) / 1000));
}

/** True when any window may be missing liquidations — the block's one-line warning. */
export function anyMissing(rows: readonly WebLiquidationUptime[]): boolean {
  return rows.some((r) => r.windows.some((w) => w.state === 'not_recorded'));
}

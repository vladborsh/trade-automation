import type { Instrument, Panel } from '@trade-automation/contracts';

/** A panel's header/strip title: its own `title`, else its instrument's display name, else the raw id. */
export function panelTitle(panel: Panel, instruments: readonly Instrument[]): string {
  return (
    panel.title ??
    instruments.find((i) => i.id === panel.instrument)?.displayName ??
    panel.instrument
  );
}

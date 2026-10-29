import { ru } from '../../i18n/ru';
import type { StringKey } from '../../i18n/keys';
import { legendEntries } from './pane-legend';
import { PANELS } from './panels.model';
import { LEVEL_COLOURS } from './prior-levels';
import { SESSIONS } from './trading-sessions';
import { EVENT_LINE_COLOUR } from './calendar-marks';
import { CLOSED_BAND_SWATCH } from './weekend-bands';

const t = (key: StringKey): string => (ru as Record<string, string>)[key] ?? `MISSING:${key}`;
const price = PANELS.find((p) => p.key === 'price')!;
const funding = PANELS.find((p) => p.key === 'funding')!;

describe('legendEntries', () => {
  it('keys the session bands, the level lines, the event lines and the closed bands on the price pane', () => {
    const entries = legendEntries(price, { timeframe: '15m' }, t);
    expect(entries).toHaveLength(price.legend.length + SESSIONS.length + 4);
    expect(entries.slice(price.legend.length).map((e) => e.colour)).toEqual([
      ...SESSIONS.map((s) => s.swatch), LEVEL_COLOURS.day, LEVEL_COLOURS.week, EVENT_LINE_COLOUR, CLOSED_BAND_SWATCH,
    ]);
    expect(entries.at(-2)?.line).toBe(true);
    expect(entries.at(-1)?.line).toBe(false);
    for (const e of entries) expect(e.label).not.toMatch(/MISSING/);
  });

  it('drops the sessions where they are not drawn (4h, 1d), keeps the levels and the events', () => {
    expect(legendEntries(price, { timeframe: '4h' }, t)).toHaveLength(price.legend.length + 4);
    // and on 1d the closed bands too: every bar is a day there
    const daily = legendEntries(price, { timeframe: '1d' }, t);
    expect(daily).toHaveLength(price.legend.length + 3);
    expect(daily.map((e) => e.colour)).not.toContain(CLOSED_BAND_SWATCH);
  });

  it('leaves the other panes alone', () => {
    expect(legendEntries(funding, { timeframe: '1m' }, t)).toHaveLength(funding.legend.length);
  });

  it('before data, the price pane shows only its own entries', () => {
    expect(legendEntries(price, null, t)).toHaveLength(price.legend.length);
  });
});

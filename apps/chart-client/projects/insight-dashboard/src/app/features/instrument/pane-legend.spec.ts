import { ru } from '../../i18n/ru';
import type { StringKey } from '../../i18n/keys';
import { legendEntries } from './pane-legend';
import { SPOT_LINE_COLOUR } from './panel-series';
import { PANELS } from './panels.model';

const t = (key: StringKey): string => (ru as Record<string, string>)[key] ?? `MISSING:${key}`;
const price = PANELS.find((p) => p.key === 'price')!;
const funding = PANELS.find((p) => p.key === 'funding')!;

describe('legendEntries', () => {
  it('adds the spot line to the price pane when it is drawn', () => {
    const entries = legendEntries(price, { spotState: 'shown' }, t);
    expect(entries.at(-1)).toEqual({ label: t('instrument.legend.spot'), colour: SPOT_LINE_COLOUR, line: true });
    expect(entries).toHaveLength(price.legend.length + 1);
  });

  it('says WHY there is no spot line, and the two reasons read differently', () => {
    const none = legendEntries(price, { spotState: 'none' }, t).at(-1)!;
    const failed = legendEntries(price, { spotState: 'failed' }, t).at(-1)!;
    expect(none.colour).toBeNull();
    expect(failed.colour).toBeNull();
    expect(none.label).not.toBe(failed.label);
    expect(none.label).not.toMatch(/MISSING/);
    expect(failed.label).not.toMatch(/MISSING/);
  });

  it('leaves the other panes alone', () => {
    expect(legendEntries(funding, { spotState: 'shown' }, t)).toHaveLength(funding.legend.length);
  });

  it('before data, the price pane shows only its own entries', () => {
    expect(legendEntries(price, null, t)).toHaveLength(price.legend.length);
  });
});

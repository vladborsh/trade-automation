import type { WebDexFieldPresence } from '@trade-automation/contracts';
import { dexFieldTotals, MIN_ASKS_FOR_A_RATE, toDexFieldViews, unpromoted } from './dex-field-rows';

/**
 * IB-028 — the GoPlus field-presence block.
 *
 * The thing it must never do is state a rate it does not have: a 0 % over two asks and a 0 % over
 * four hundred are the same number about different worlds, and only the second is an outage.
 */
const row = (over: Partial<WebDexFieldPresence> = {}): WebDexFieldPresence => ({
  chainFamily: 'evm',
  field: 'buy_tax',
  answered: 40,
  present: 40,
  presentRate: 1,
  presence: 'always',
  evidence: 'present in all answered tokens, occasions A and B',
  ...over,
});

describe('toDexFieldViews', () => {
  it('states a rate with its denominator — the positive control', () => {
    const [view] = toDexFieldViews([row({ answered: 40, present: 38, presentRate: 38 / 40 })]);
    expect(view.rateLabel).toBe('95 %');
    expect(view.presentLabel).toBe('38 of 40');
    expect(view.state).toBe('varies');
  });

  it('calls an always-present field answered by NOBODY gone — the alarm', () => {
    const [view] = toDexFieldViews([row({ answered: 40, present: 0, presentRate: 0 })]);
    expect(view.state).toBe('gone');
    expect(view.rateLabel).toBe('0 %');
  });

  it('refuses to state a rate below the minimum, and says so rather than showing 0 %', () => {
    const [view] = toDexFieldViews([row({
      answered: MIN_ASKS_FOR_A_RATE - 1, present: 0, presentRate: 0,
    })]);
    expect(view.state).toBe('thin');
    expect(view.rateLabel).toBe('—'); // NOT '0 %': the claim is not available yet
  });

  it('shows no rate at all when nothing was answered', () => {
    const [view] = toDexFieldViews([row({ answered: 0, present: 0, presentRate: null })]);
    expect(view.rateLabel).toBe('—');
    expect(view.presentLabel).toBe('0 of 0');
    expect(view.state).toBe('thin');
  });

  it('does not alarm on an OPTIONAL field that is simply absent for some tokens', () => {
    // is_open_source was absent on 4 of 9 answered BSC tokens and that is the venue's normal
    const [view] = toDexFieldViews([row({
      field: 'is_open_source', presence: 'optional', answered: 9, present: 5, presentRate: 5 / 9,
    })]);
    expect(view.state).toBe('varies');
  });

  it('does not alarm on an optional field nobody answered either', () => {
    const [view] = toDexFieldViews([row({
      field: 'cannot_buy', presence: 'optional', answered: 40, present: 0, presentRate: 0,
    })]);
    expect(view.state).toBe('varies'); // only an `always` field going to zero is the alarm
  });

  it('puts the alarm first and keeps the order stable', () => {
    const views = toDexFieldViews([
      row({ field: 'sell_tax' }),
      row({ field: 'holder_count', presence: 'optional', answered: 40, present: 20, presentRate: 0.5 }),
      row({ field: 'buy_tax', answered: 40, present: 0, presentRate: 0 }),
      row({ field: 'total_supply', answered: 2, present: 2, presentRate: 1 }),
    ]);
    expect(views.map((v) => v.field)).toEqual(['buy_tax', 'holder_count', 'total_supply', 'sell_tax']);
  });
});

describe('dexFieldTotals', () => {
  it('counts the alarm, and how many fields a claim is possible for', () => {
    const totals = dexFieldTotals([
      row({ field: 'buy_tax', answered: 40, present: 0, presentRate: 0 }),
      row({ field: 'sell_tax', answered: 40, present: 40, presentRate: 1 }),
      row({ field: 'total_supply', answered: 1, present: 1, presentRate: 1 }),
    ]);
    expect(totals).toEqual({ fields: 3, gone: 1, measured: 2, answered: 40 });
  });

  it('reports nothing measured when no ask has been answered', () => {
    expect(dexFieldTotals([row({ answered: 0, present: 0, presentRate: null })]))
      .toEqual({ fields: 1, gone: 0, measured: 0, answered: 0 });
  });
});

describe('unpromoted — the rows whose correctness is invisible', () => {
  it('picks an OPTIONAL field answered for every token in a long-enough window', () => {
    // the exact row a reader would "correct" to always, reinstating the throw that lost rows
    const views = unpromoted([row({
      field: 'holder_count', presence: 'optional', answered: 35, present: 35, presentRate: 1,
      evidence: 'present in all 36 answered tokens of A and B, then ABSENT on a live eth token minutes later',
    })]);
    expect(views.map((v) => v.field)).toEqual(['holder_count']);
    expect(views[0].evidence).toContain('ABSENT on a live eth token');
  });

  it('leaves out an optional field that is visibly below 100 %, which explains itself', () => {
    expect(unpromoted([row({
      field: 'is_open_source', presence: 'optional', answered: 9, present: 5, presentRate: 5 / 9,
    })])).toEqual([]);
  });

  it('leaves out an ALWAYS field at 100 %, which is not a surprise to anybody', () => {
    expect(unpromoted([row({ answered: 40, present: 40, presentRate: 1 })])).toEqual([]);
  });

  it('leaves out a thin row, because it is not claiming 100 % in the first place', () => {
    expect(unpromoted([row({
      presence: 'optional', answered: MIN_ASKS_FOR_A_RATE - 1, present: MIN_ASKS_FOR_A_RATE - 1, presentRate: 1,
    })])).toEqual([]);
  });

  it('carries the evidence, so the page can print WHY rather than just flagging it', () => {
    const [view] = unpromoted([row({ presence: 'optional', answered: 20, present: 20, presentRate: 1 })]);
    expect(view.evidence.length).toBeGreaterThan(20);
  });
});


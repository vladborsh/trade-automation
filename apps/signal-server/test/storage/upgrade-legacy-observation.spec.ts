import { MetricObservationSchema } from '@trade-automation/contracts';
import { upgradeLegacyObservation } from '../../src/storage/upgrade-legacy-observation';

describe('upgradeLegacyObservation (architecture/chart-layouts.md §11.1 "Legacy stored rows")', () => {
  const legacyHistoryRow = { metric: 'openInterest', instrument: 'binance:BTCUSDT', time: 1, value: 10, notional: 1000 };
  const legacySnapshotRow = { metric: 'openInterest', instrument: 'binance:BTCUSDT', time: 2, value: 11 };

  it("tags a legacy history row with unit 'base' and notionalBasis 'venue'", () => {
    const upgraded = upgradeLegacyObservation(legacyHistoryRow);
    expect(upgraded).toEqual({ ...legacyHistoryRow, unit: 'base', notionalBasis: 'venue' });
    expect(MetricObservationSchema.parse(upgraded)).toEqual(upgraded);
  });

  it("tags a legacy snapshot row with unit 'base' and no notionalBasis", () => {
    const upgraded = upgradeLegacyObservation(legacySnapshotRow);
    expect(upgraded).toEqual({ ...legacySnapshotRow, unit: 'base' });
    expect(upgraded).not.toHaveProperty('notionalBasis');
  });

  it('keeps fields a current row already carries', () => {
    const current = { ...legacyHistoryRow, unit: 'contracts', notionalBasis: 'derived' };
    expect(upgradeLegacyObservation(current)).toEqual(current);
  });

  it('does not mutate its input', () => {
    const input = { ...legacyHistoryRow };
    upgradeLegacyObservation(input);
    expect(input).toEqual(legacyHistoryRow);
  });
});

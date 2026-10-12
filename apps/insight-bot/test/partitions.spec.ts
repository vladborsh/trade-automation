import {
  buildCreatePartition,
  monthOf,
  monthsAhead,
  monthsBetween,
  nextMonth,
  PARTITIONED_TABLES,
  partitionName,
  partitionsFor,
} from '../src/db/partitions';

describe('month arithmetic', () => {
  it('reads a month in UTC, not in the host timezone', () => {
    // 2026-01-01T00:30Z is still December where the host is UTC-1; the app is UTC-only (§3.1).
    expect(monthOf(new Date('2026-01-01T00:30:00Z'))).toBe('2026-01');
    expect(monthOf(new Date('2026-09-30T23:59:59Z'))).toBe('2026-09');
  });

  it('rolls the year at December', () => {
    expect(nextMonth('2026-11')).toBe('2026-12');
    expect(nextMonth('2026-12')).toBe('2027-01');
  });

  it('rejects anything that is not YYYY-MM', () => {
    for (const bad of ['2026-13', '2026-00', '2026-9', '26-09', '2026-09-01', 'drop table']) {
      expect(() => nextMonth(bad)).toThrow(/Not a YYYY-MM month/);
    }
  });

  it('lists every month a range touches, inclusive of both ends', () => {
    expect(monthsBetween(new Date('2026-09-28T00:00:00Z'), new Date('2026-12-01T00:00:00Z'))).toEqual([
      '2026-09', '2026-10', '2026-11', '2026-12',
    ]);
    expect(monthsBetween(new Date('2026-09-01T00:00:00Z'), new Date('2026-09-30T23:59:59Z'))).toEqual(['2026-09']);
  });

  it('crosses a year end and a leap February', () => {
    expect(monthsBetween(new Date('2027-11-15T00:00:00Z'), new Date('2028-03-01T00:00:00Z'))).toEqual([
      '2027-11', '2027-12', '2028-01', '2028-02', '2028-03',
    ]);
  });

  it('returns nothing for a backwards range — a backfill that is already up to date', () => {
    expect(monthsBetween(new Date('2026-09-10T00:00:00Z'), new Date('2026-09-09T00:00:00Z'))).toEqual([]);
  });

  it('gives the current month plus N ahead (D7 keeps three)', () => {
    expect(monthsAhead(new Date('2026-10-20T00:00:00Z'), 3)).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
    expect(monthsAhead(new Date('2026-10-20T00:00:00Z'), 0)).toEqual(['2026-10']);
    expect(() => monthsAhead(new Date(), -1)).toThrow(/non-negative integer/);
  });
});

describe('partitionsFor', () => {
  it('names a partition <table>_<year>_<month> and bounds it on the calendar month', () => {
    expect(partitionName('candles_1m', '2026-09')).toBe('candles_1m_2026_09');
    const [first] = partitionsFor(['2026-09'], [{ table: 'candles_1m', column: 'open_time' }]);
    expect(first).toEqual({
      table: 'candles_1m',
      month: '2026-09',
      name: 'candles_1m_2026_09',
      from: '2026-09-01',
      to: '2026-10-01',
    });
  });

  it('closes a December partition on the 1st of January', () => {
    const [december] = partitionsFor(['2026-12'], [{ table: 'liquidations', column: 'ts' }]);
    expect(december.from).toBe('2026-12-01');
    expect(december.to).toBe('2027-01-01');
  });

  it('covers every partitioned table, and nothing else', () => {
    // An "and nothing else" pin, deliberately: a table joining this list silently means its
    // partitions start being created by a maintenance job nobody reviewed, and a table LEAVING
    // it silently means writes start failing at the next month boundary.
    expect(PARTITIONED_TABLES.map((t) => t.table)).toEqual([
      // migration 002
      'candles_1m', 'candles_agg', 'mark_funding_1m', 'open_interest_5m', 'long_short_5m', 'liquidations', 'collector_gaps',
      // migration 011 (IB-015)
      'feature_frames',
      // migration 015 (IB-017) — the per-close audit row
      'playbook_evaluations',
      // migration 016 (IB-028) — the DEX snapshot history
      'dex_pools',
    ]);
    // The two unpartitioned tables of §3.3 must not appear.
    expect(PARTITIONED_TABLES.map((t) => t.table)).not.toContain('funding_settlements');
    expect(PARTITIONED_TABLES.map((t) => t.table)).not.toContain('calendar_events');
    // Nor IB-017's current-state and signal tables: `playbook_state` holds one row per
    // playbook x symbol x arm x mode for the life of the product, and `signals` is a handful of
    // rows a day. Partitioning either would be maintenance with nothing to maintain.
    expect(PARTITIONED_TABLES.map((t) => t.table)).not.toContain('playbook_state');
    expect(PARTITIONED_TABLES.map((t) => t.table)).not.toContain('signals');
    expect(PARTITIONED_TABLES.map((t) => t.table)).not.toContain('cooldowns');
    // Nor the version guard: one row per frame_version for the life of the product, not a series.
    expect(PARTITIONED_TABLES.map((t) => t.table)).not.toContain('feature_frame_versions');
    expect(partitionsFor(['2026-09', '2026-10'])).toHaveLength(PARTITIONED_TABLES.length * 2);
  });
});

describe('buildCreatePartition — the bounds are explicitly UTC', () => {
  it('pins both bounds to +00, because the partition key is timestamptz', () => {
    // A bare '2026-09-01' is resolved in the DATABASE SESSION's timezone, not the app's. Found
    // by IB-012: on a US/Pacific session every partition slid 7 hours, so the first 7 hours of
    // each month had no partition and the insert failed with "no partition of relation found".
    const sql = buildCreatePartition({ table: 'candles_1m', month: '2026-09', name: 'candles_1m_2026_09', from: '2026-09-01', to: '2026-10-01' });
    expect(sql).toContain("from ('2026-09-01 00:00:00+00')");
    expect(sql).toContain("to ('2026-10-01 00:00:00+00')");
  });
});

describe('buildCreatePartition', () => {
  const partition = partitionsFor(['2026-09'], [{ table: 'candles_1m', column: 'open_time' }])[0];

  it('builds an IF NOT EXISTS statement, so re-running maintenance is a no-op', () => {
    expect(buildCreatePartition(partition)).toBe(
      "create table if not exists candles_1m_2026_09 partition of candles_1m for values from ('2026-09-01 00:00:00+00') to ('2026-10-01 00:00:00+00')",
    );
  });

  it('refuses a table that is not one of the partitioned ones', () => {
    expect(() => buildCreatePartition({ ...partition, table: 'symbols', name: 'symbols_2026_09' })).toThrow(
      /Not a partitioned table/,
    );
  });

  it('refuses a month or a name that did not come from this module', () => {
    // DDL takes no bind parameters, so both identifiers are interpolated; these are the guards.
    expect(() => buildCreatePartition({ ...partition, month: "2026-09'; drop table candles_1m; --" })).toThrow(
      /Not a YYYY-MM month/,
    );
    expect(() => buildCreatePartition({ ...partition, name: 'something_else' })).toThrow(/does not match/);
  });
});

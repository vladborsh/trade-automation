import * as fs from 'fs';
import * as path from 'path';
import { Instrument, MetricKind, MetricObservation, Venue } from '@trade-automation/contracts';
import { MetricAdapter } from '../metric-adapter.port';

/**
 * architecture/chart-layouts.md §4.4 — the ReplayAdapter-equivalent for metrics: reads a local
 * JSONL fixture (one line per MetricObservation, ascending by `time`), so the ingestion
 * pipeline and the chart-client's mock server can run without live Binance access. Mirrors
 * `ReplayAdapter` (candles) — no venue call, no streaming, `fetchLatest` just returns the
 * fixture's last observation.
 *
 * Fixture layout: `<fixturesDir>/<venue>/<symbol>/<metric>.jsonl`.
 */
export class ReplayMetricAdapter implements MetricAdapter {
  readonly supports: readonly MetricKind[] = ['openInterest'];

  constructor(
    public readonly venue: Venue,
    private readonly fixturesDir: string,
  ) {}

  private fixturePath(instrument: Instrument, metric: MetricKind): string {
    return path.join(this.fixturesDir, instrument.venue, instrument.symbol, `${metric}.jsonl`);
  }

  private loadFixture(instrument: Instrument, metric: MetricKind): MetricObservation[] {
    const file = this.fixturePath(instrument, metric);
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as MetricObservation)
      .sort((a, b) => a.time - b.time);
  }

  async fetchObservations(
    instrument: Instrument,
    metric: MetricKind,
    from: number,
    to: number,
  ): Promise<MetricObservation[]> {
    return this.loadFixture(instrument, metric).filter((o) => o.time >= from && o.time <= to);
  }

  async fetchLatest(instrument: Instrument, metric: MetricKind): Promise<MetricObservation> {
    const fixture = this.loadFixture(instrument, metric);
    const last = fixture[fixture.length - 1];
    if (!last) {
      throw new Error(`ReplayMetricAdapter: no fixture observations for ${instrument.id}/${metric}`);
    }
    return { ...last, time: Date.now() };
  }
}

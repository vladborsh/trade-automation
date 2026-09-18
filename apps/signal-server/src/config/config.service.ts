import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { Env } from './env.schema';
import { InstrumentsFile, InstrumentsFileSchema } from './instruments.schema';
import { LayoutsFile, LayoutsFileSchema } from './layouts.schema';
import { MetricAggregatesFile, MetricAggregatesFileSchema } from './metric-aggregates.schema';
import { StrategiesFile, StrategiesFileSchema } from './strategies.schema';

/**
 * Loads and zod-validates instruments.yaml / strategies.yaml / layouts.yaml at boot.
 * An invalid file is a boot failure (architecture/live-signal-server.md §4.7).
 */
@Injectable()
export class AppConfigService {
  private readonly instrumentsFile: InstrumentsFile;
  private readonly strategiesFile: StrategiesFile;
  private readonly layoutsFile: LayoutsFile;
  private readonly metricAggregatesFile: MetricAggregatesFile;

  constructor(private readonly nestConfig: NestConfigService<Env, true>) {
    this.instrumentsFile = this.loadYaml(
      this.nestConfig.get('INSTRUMENTS_FILE'),
      InstrumentsFileSchema,
    );
    this.strategiesFile = this.loadYaml(this.nestConfig.get('STRATEGIES_FILE'), StrategiesFileSchema);
    this.layoutsFile = this.loadYaml(this.nestConfig.get('LAYOUTS_FILE'), LayoutsFileSchema);
    // aggregate-oi.md §3.3 — the env default always names a file; only a config with no value
    // at all (unit-test fakes) means "no aggregates", and a layout naming one then fails below.
    const aggregatesPath = this.nestConfig.get('METRIC_AGGREGATES_FILE');
    this.metricAggregatesFile = aggregatesPath
      ? this.loadYaml(aggregatesPath, MetricAggregatesFileSchema)
      : { aggregates: [] };
    this.assertLayoutInstrumentsExist();
    this.assertLayoutAggregatesExist();
  }

  /**
   * architecture/aggregate-oi.md §3.3 — every panel.aggregate must exist in
   * metric-aggregates.yaml, its metric must match the panel's, and the panel's anchor
   * instrument must be one of its members. Member adapters are checked once the adapters exist
   * (MetricIngestionService, `assertAggregateMembersIngestible`).
   */
  private assertLayoutAggregatesExist(): void {
    const byId = new Map(this.metricAggregatesFile.aggregates.map((a) => [a.id, a]));
    for (const layout of this.layoutsFile.layouts) {
      for (const panel of layout.panels) {
        if (!panel.aggregate) continue;
        const where = `layouts.yaml: layout '${layout.id}' panel '${panel.id}'`;
        const aggregate = byId.get(panel.aggregate);
        if (!aggregate) {
          throw new Error(
            `${where} references unknown aggregate '${panel.aggregate}' — not present in metric-aggregates.yaml. ` +
              `Refusing to boot with this configuration.`,
          );
        }
        if (aggregate.metric !== panel.metric) {
          throw new Error(`${where}: metric '${panel.metric}' differs from aggregate '${aggregate.id}' metric '${aggregate.metric}'.`);
        }
        if (!aggregate.members.some((m) => m.id === panel.instrument)) {
          throw new Error(`${where}: anchor instrument '${panel.instrument}' is not a member of aggregate '${aggregate.id}'.`);
        }
      }
    }
  }

  /**
   * architecture/chart-layouts.md §2.2 — every panel.instrument must exist in instruments.yaml;
   * an unresolved reference is a boot failure, like every other config error (base §4.7).
   */
  private assertLayoutInstrumentsExist(): void {
    const known = new Set(this.instrumentsFile.instruments.map((i) => i.id));
    for (const layout of this.layoutsFile.layouts) {
      for (const panel of layout.panels) {
        if (!known.has(panel.instrument)) {
          throw new Error(
            `layouts.yaml: layout '${layout.id}' panel '${panel.id}' references unknown instrument ` +
              `'${panel.instrument}' — not present in instruments.yaml. Refusing to boot with this configuration.`,
          );
        }
      }
    }
  }

  private loadYaml<T>(path: string, schema: { parse(input: unknown): T }): T {
    if (!fs.existsSync(path)) {
      throw new Error(`Config file not found: ${path}`);
    }
    const raw = yaml.load(fs.readFileSync(path, 'utf8'));
    try {
      return schema.parse(raw);
    } catch (err) {
      throw new Error(`Invalid config file ${path}: ${(err as Error).message}`);
    }
  }

  get env(): NestConfigService<Env, true> {
    return this.nestConfig;
  }

  get instruments() {
    return this.instrumentsFile.instruments;
  }

  get strategies() {
    return this.strategiesFile.strategies;
  }

  get layouts() {
    return this.layoutsFile.layouts;
  }

  get metricAggregates() {
    return this.metricAggregatesFile.aggregates;
  }
}

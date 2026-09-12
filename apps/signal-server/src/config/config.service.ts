import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { Env } from './env.schema';
import { InstrumentsFile, InstrumentsFileSchema } from './instruments.schema';
import { LayoutsFile, LayoutsFileSchema } from './layouts.schema';
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

  constructor(private readonly nestConfig: NestConfigService<Env, true>) {
    this.instrumentsFile = this.loadYaml(
      this.nestConfig.get('INSTRUMENTS_FILE'),
      InstrumentsFileSchema,
    );
    this.strategiesFile = this.loadYaml(this.nestConfig.get('STRATEGIES_FILE'), StrategiesFileSchema);
    this.layoutsFile = this.loadYaml(this.nestConfig.get('LAYOUTS_FILE'), LayoutsFileSchema);
    this.assertLayoutInstrumentsExist();
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
}

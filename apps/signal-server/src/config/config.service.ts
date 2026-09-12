import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { Env } from './env.schema';
import { InstrumentsFile, InstrumentsFileSchema } from './instruments.schema';
import { StrategiesFile, StrategiesFileSchema } from './strategies.schema';

/**
 * Loads and zod-validates instruments.yaml / strategies.yaml at boot.
 * An invalid file is a boot failure (architecture/live-signal-server.md §4.7).
 */
@Injectable()
export class AppConfigService {
  private readonly instrumentsFile: InstrumentsFile;
  private readonly strategiesFile: StrategiesFile;

  constructor(private readonly nestConfig: NestConfigService<Env, true>) {
    this.instrumentsFile = this.loadYaml(
      this.nestConfig.get('INSTRUMENTS_FILE'),
      InstrumentsFileSchema,
    );
    this.strategiesFile = this.loadYaml(this.nestConfig.get('STRATEGIES_FILE'), StrategiesFileSchema);
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
}

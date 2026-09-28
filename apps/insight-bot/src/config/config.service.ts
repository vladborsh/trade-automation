import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import { Env } from './env.schema';
import { loadUniverseFile } from './universe.loader';
import { UniverseFile, UniverseSymbol } from './universe.schema';

/**
 * Loads and zod-validates `universe.yaml` at boot (§2.3). An invalid file is a boot failure,
 * the same contract signal-server's `AppConfigService` has for its three yaml files.
 */
@Injectable()
export class AppConfigService {
  private readonly universeFile: UniverseFile;

  constructor(private readonly nestConfig: NestConfigService<Env, true>) {
    this.universeFile = loadUniverseFile(this.nestConfig.get('UNIVERSE_FILE'));
  }

  get env(): NestConfigService<Env, true> {
    return this.nestConfig;
  }

  get universe(): UniverseFile {
    return this.universeFile;
  }

  get symbols(): readonly UniverseSymbol[] {
    return this.universeFile.symbols;
  }

  get signalSet(): readonly string[] {
    return this.universeFile.signal_set;
  }
}

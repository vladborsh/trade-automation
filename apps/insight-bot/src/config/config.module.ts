import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { AppConfigService } from './config.service';
import { validateEnv } from './env.schema';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      // BUG-008 (signal-server): the suite sets IGNORE_ENV_FILE=true (test/setup.ts) so a spec
      // never picks up a checkout's apps/insight-bot/.env — a real DATABASE_URL, a Telegram
      // token. A key a spec leaves unset then really means the schema default. Servers never
      // set it.
      ignoreEnvFile: process.env.IGNORE_ENV_FILE === 'true',
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}

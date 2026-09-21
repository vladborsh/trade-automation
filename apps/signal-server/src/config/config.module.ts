import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validateEnv } from './env.schema';
import { AppConfigService } from './config.service';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      // BUG-008: the test suite sets IGNORE_ENV_FILE=true (test/setup.ts) so a spec never picks up
      // a checkout's apps/signal-server/.env (live mode, a real DATABASE_URL, broker keys). A key a
      // spec leaves unset then really means the schema default. Servers never set it.
      ignoreEnvFile: process.env.IGNORE_ENV_FILE === 'true',
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}

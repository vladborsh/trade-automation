// architecture/live-signal-server.md §4.6: TZ must be set and asserted before anything else
// boots — this is the systemic fix for the host-timezone bug class both knowledge files
// (session-liquidity.md, smart-money-ict.md) document against a non-UTC host.
process.env.TZ = 'UTC';
if (new Date().getTimezoneOffset() !== 0) {
  // eslint-disable-next-line no-console
  console.error(
    `FATAL: process timezone offset is ${new Date().getTimezoneOffset()}, expected 0 (UTC). ` +
      'Refusing to boot on a non-UTC host — see architecture/live-signal-server.md §4.6.',
  );
  process.exit(1);
}

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  app.get(Logger).log(`signal-server listening on :${port} (TZ=${process.env.TZ})`);
}

bootstrap();

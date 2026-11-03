// architecture/insight-bot-system-design.md §3.1 — every time this app stores or reasons about
// is UTC; the clocks of §8.1 are UTC boundaries. Set and asserted before anything else boots,
// the same guard signal-server carries (live-signal-server.md §4.6) against a non-UTC host.
process.env.TZ = 'UTC';
if (new Date().getTimezoneOffset() !== 0) {
  // eslint-disable-next-line no-console
  console.error(
    `FATAL: process timezone offset is ${new Date().getTimezoneOffset()}, expected 0 (UTC). ` +
      'Refusing to boot on a non-UTC host — see architecture/insight-bot-system-design.md §3.1.',
  );
  process.exit(1);
}

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  // §7 — no inbound ports in production: /healthz and /metrics are read from the box itself
  // (SSM Session Manager), so the listener stays on loopback there. A dev slot binds the same
  // way; AGENTS.md assigns the port per slot (:3005/:3015/:3025/:3035/:3045).
  const port = Number(process.env.PORT ?? 3005);
  await app.listen(port);
  app.get(Logger).log(`insight-bot listening on :${port} (TZ=${process.env.TZ})`);
}

bootstrap();

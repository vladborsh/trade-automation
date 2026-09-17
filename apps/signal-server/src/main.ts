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
import { IngestionService } from './market-data/ingestion.service';
import { MetricIngestionService } from './market-data/metrics/metric-ingestion.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();

  // Dev convenience only: when the client is served separately (e.g. `ng serve` on :4200)
  // instead of by this server's ServeStaticModule, the browser enforces CORS across ports.
  // Unset in production, where the client is same-origin.
  if (process.env.CORS_ORIGIN) {
    app.enableCors({ origin: process.env.CORS_ORIGIN });
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  app.get(Logger).log(`signal-server listening on :${port} (TZ=${process.env.TZ})`);

  // architecture/live-signal-server.md §12.3 Phase 2 — deliberately fire-and-forget: the chart
  // is already usable at full §12.2 depth for every timeframe from Phase 1 alone (synchronous,
  // above); this only deepens the 1m backfill (and, as a side effect, the derived timeframes
  // resampled from it) further back in the background. `/api/health`'s `backfillStatus` reflects
  // progress; a failure here is logged inside the service and never affects server liveness.
  void app.get(IngestionService).deepenHistoryAsync();

  // architecture/panel-sync-and-oi-depth-diagnosis.md, Bug 2, defect 2 — same fire-and-forget
  // Phase 2 concept as the candle path above, for metric (open-interest) history: `/api/health`'s
  // per-pair `backfillStatus` reflects progress; a failure is logged inside the service.
  void app.get(MetricIngestionService).deepenHistoryAsync();
}

bootstrap();

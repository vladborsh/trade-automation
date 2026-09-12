import * as opentelemetry from '@opentelemetry/sdk-node';
import { credentials } from '@grpc/grpc-js';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-grpc';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { getLocalEnvConfig } from './set-local-env-config';

const envConfig = getLocalEnvConfig();

if (envConfig.ENVIRONMENT === 'development') {
  const otlpServer = 'http://localhost:4317/';

  const isHttps = otlpServer.startsWith('https://');
  const collectorOptions = {
    credentials: !isHttps ? credentials.createInsecure() : credentials.createSsl(),
  };

  // For troubleshooting, set the log level to DiagLogLevel.DEBUG
  // diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ALL);

  const sdk = new opentelemetry.NodeSDK({
    resource: new opentelemetry.resources.Resource({
      ["service.name"]: 'signal-bot',
    }),
    traceExporter: new OTLPTraceExporter(collectorOptions),
    metricReader: new PeriodicExportingMetricReader({
      exportIntervalMillis: 5000,
      exporter: new OTLPMetricExporter(collectorOptions),
    }),
    logRecordProcessor: new SimpleLogRecordProcessor(new OTLPLogExporter(collectorOptions)),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
}

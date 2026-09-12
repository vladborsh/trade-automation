import './utils/otel-setup';
import { runTelegramBot } from './bot-main';
import { setupPortListener } from './port-listener';
import { getLocalEnvConfig } from './utils/set-local-env-config';
import 'reflect-metadata';

const envConfig = getLocalEnvConfig();

setupPortListener(envConfig);
runTelegramBot();

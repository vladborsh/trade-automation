import dotenv from 'dotenv';
import { EnvConfig } from '../env-config';

export function getLocalEnvConfig() {
  const isDotEnvEnabled = process.argv.includes('--local');

  if (isDotEnvEnabled) {
    dotenv.config();
  }

  return EnvConfig.getInstance();
}

import 'reflect-metadata';
import { installNetworkGuard } from './network-guard';

// BUG-008: every spec is hermetic against the checkout. config.module.ts never reads
// apps/signal-server/.env under the suite (set before any spec imports src/), and no spec can
// open a connection to a non-loopback host (asserted per spec file in setup-after-env.ts).
process.env.IGNORE_ENV_FILE = 'true';
installNetworkGuard();

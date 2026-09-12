import { z } from 'zod';
import { InstrumentSchema } from '@trade-automation/contracts';

/** instruments.yaml — the configured universe (architecture/live-signal-server.md §3.1, §4.7). */
export const InstrumentsFileSchema = z.object({
  instruments: z.array(InstrumentSchema).min(1),
});
export type InstrumentsFile = z.infer<typeof InstrumentsFileSchema>;

import { z } from 'zod';
import { InstrumentIdSchema } from '@trade-automation/contracts';

/** strategies.yaml — enablement + per-strategy params keyed by instrument (§4.7). */
export const StrategyConfigEntrySchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean().default(false),
  instruments: z.array(InstrumentIdSchema).default([]),
  params: z.record(z.string(), z.unknown()).default({}),
});
export type StrategyConfigEntry = z.infer<typeof StrategyConfigEntrySchema>;

export const StrategiesFileSchema = z.object({
  strategies: z.array(StrategyConfigEntrySchema).default([]),
});
export type StrategiesFile = z.infer<typeof StrategiesFileSchema>;

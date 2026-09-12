import { z } from 'zod';
import { TimeframeSchema } from './timeframe';
import { InstrumentIdSchema } from './instrument';

/** architecture/live-signal-server.md §4.4 — strategy plug-in requirements, shared with config validation. */
export const StrategyRequirementsSchema = z.object({
  instruments: z.array(InstrumentIdSchema),
  timeframe: TimeframeSchema,
  auxTimeframes: z.array(TimeframeSchema).optional(),
  warmupBars: z.record(TimeframeSchema, z.number().int().nonnegative()),
});
export type StrategyRequirements = z.infer<typeof StrategyRequirementsSchema>;

import { z } from 'zod';

const HhMm = z.string().regex(/^\d{2}:\d{2}$/, 'expected "hh:mm"');
const EntryWindowSchema = z.tuple([HhMm, HhMm]);

/**
 * architecture/vwap-band-reversal-plugin.md §7 — strategies.yaml params for this plug-in,
 * zod-validated in the factory so a missing entryWindow for an enabled instrument is a boot
 * error, not a silent "never fires". Keys of `entryWindow` are `InstrumentId` strings.
 */
export const VwapBandReversalParamsSchema = z.object({
  sessionTimezone: z.string().min(1),
  minVwapAtrRatio: z.number(),
  maxVwapAtrRatio: z.number(),
  maxIfvgToAtrRatio: z.number(),
  targetRr: z.number().positive(),
  rangeBars: z.number().int().positive(),
  atrBars: z.number().int().positive(),
  mainWindowMinutes: z.number().int().positive(),
  entryWindow: z.record(z.string(), EntryWindowSchema),
});
export type VwapBandReversalParams = z.infer<typeof VwapBandReversalParamsSchema>;

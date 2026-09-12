import { z } from 'zod';
import { LayoutSchema } from '@trade-automation/contracts';

/** layouts.yaml — named multi-panel layout-setups (architecture/chart-layouts.md §2.2). */
export const LayoutsFileSchema = z
  .object({
    layouts: z.array(LayoutSchema).min(1),
  })
  .superRefine((f, ctx) => {
    if (new Set(f.layouts.map((l) => l.id)).size !== f.layouts.length) {
      ctx.addIssue({ code: 'custom', message: 'duplicate layout id' });
    }
  });
export type LayoutsFile = z.infer<typeof LayoutsFileSchema>;

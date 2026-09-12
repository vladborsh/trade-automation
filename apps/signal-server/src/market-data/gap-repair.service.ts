import { Injectable } from '@nestjs/common';
import { GapRepair } from './gap-repair';

/** Nest-visible singleton wrapping the pure `GapRepair` (kept pure for direct unit testing). */
@Injectable()
export class GapRepairService extends GapRepair {}

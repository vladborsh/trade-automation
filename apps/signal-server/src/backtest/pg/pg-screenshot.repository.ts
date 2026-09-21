import type { ScreenshotKind } from '@trade-automation/contracts';
import { DbHandle } from '../../db/db.port';
import { NewScreenshot, ScreenshotRecord, ScreenshotRepository } from '../screenshot.repository.port';

interface ScreenshotRow {
  id: string;
  session_id: string;
  order_id: string;
  kind: ScreenshotKind;
  store_key: string;
  width_px: number;
  height_px: number;
  bytes: number;
  captured_at_ms: number;
}

const COLUMNS = 'id, session_id, order_id, kind, store_key, width_px, height_px, bytes, captured_at_ms';

function toRecord(r: ScreenshotRow): ScreenshotRecord {
  return {
    id: r.id,
    sessionId: r.session_id,
    orderId: r.order_id,
    kind: r.kind,
    storeKey: r.store_key,
    widthPx: r.width_px,
    heightPx: r.height_px,
    bytes: r.bytes,
    capturedAtMs: r.captured_at_ms,
  };
}

export class PgScreenshotRepository implements ScreenshotRepository {
  constructor(private readonly db: DbHandle) {}

  async insertIfAbsent(s: NewScreenshot): Promise<ScreenshotRecord | null> {
    const [row] = await this.db.query<ScreenshotRow>(
      `insert into screenshots (session_id, order_id, kind, store_key, width_px, height_px, bytes, captured_at_ms)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (order_id, kind) do nothing
       returning ${COLUMNS}`,
      [s.sessionId, s.orderId, s.kind, s.storeKey, s.widthPx, s.heightPx, s.bytes, s.capturedAtMs],
    );
    return row ? toRecord(row) : null;
  }

  async find(orderId: string, kind: ScreenshotKind): Promise<ScreenshotRecord | null> {
    const [row] = await this.db.query<ScreenshotRow>(`select ${COLUMNS} from screenshots where order_id = $1 and kind = $2`, [orderId, kind]);
    return row ? toRecord(row) : null;
  }

  async listByOrder(orderId: string): Promise<ScreenshotRecord[]> {
    const rows = await this.db.query<ScreenshotRow>(`select ${COLUMNS} from screenshots where order_id = $1 order by kind`, [orderId]);
    return rows.map(toRecord);
  }
}

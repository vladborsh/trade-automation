import {
  BadRequestException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ScreenshotKindSchema, type Order, type ScreenshotKind, type ScreenshotUploadResponse, type SessionSummary } from '@trade-automation/contracts';
import { z } from 'zod';
import { apiError } from '../auth/auth-error';
import { AppConfigService } from '../config/config.service';
import { SCREENSHOT_STORE, ScreenshotStore, screenshotKey } from '../storage/screenshot-store.port';
import { readPngInfo } from './png';
import { sessionNotFound } from './session-mutation';
import { BACKTEST_REPOSITORIES, BacktestRepositories } from './session.repository.port';
import { BodyTooLargeError, mediaType, readLimitedBody } from './upload-body';

/** §7.2: a screenshot upload is at most 2 MB. */
export const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;

const UuidSchema = z.string().uuid();

export interface ScreenshotUpload {
  contentType: string | undefined;
  contentLength: string | undefined;
  body: AsyncIterable<Buffer | string | Uint8Array> & { destroy?: () => void };
}

/**
 * architecture/backtest-app-system-design.md §7.2, §9.2, decisions 6, 27 — screenshot upload and
 * read. The key is built only from server-resolved ids: the cookie user, the session and order
 * found through the tenancy-scoped repositories, and `kind` validated against entry|exit.
 *
 * Write-once: the `screenshots` row is claimed **before** the bytes are written, in one
 * transaction (claim → store.put → commit). A concurrent upload for the same (order, kind)
 * blocks on the unique index and then gets 409 `SCREENSHOT_EXISTS` without touching the store.
 * A failed store write rolls the claim back, so a retry can succeed. (Writing the object first
 * and deleting it when the row insert loses would not work here: the key is deterministic, so
 * the loser would delete the winner's picture.)
 */
@Injectable()
export class ScreenshotService {
  private readonly logger = new Logger(ScreenshotService.name);

  constructor(
    @Inject(BACKTEST_REPOSITORIES) private readonly repos: BacktestRepositories | null,
    @Inject(SCREENSHOT_STORE) private readonly store: ScreenshotStore,
    private readonly config: AppConfigService,
  ) {}

  async put(userId: string, sessionId: string, orderId: string, kindRaw: string, upload: ScreenshotUpload): Promise<ScreenshotUploadResponse> {
    const repos = this.requireEnabled();
    const kind = parseKind(kindRaw);
    const { session, order } = await this.resolve(repos, userId, sessionId, orderId);

    if (mediaType(upload.contentType) !== 'image/png') throw new UnsupportedMediaTypeException('The body must be image/png.');
    if (await repos.screenshots.find(order.id, kind)) throw exists(); // fast path: do not read a body we will refuse

    let bytes: Buffer;
    try {
      bytes = await readLimitedBody(upload.body, upload.contentLength, MAX_SCREENSHOT_BYTES);
    } catch (err) {
      if (err instanceof BodyTooLargeError) throw new PayloadTooLargeException('A screenshot is at most 2 MB.');
      throw err;
    }
    const info = readPngInfo(bytes);
    if (!info) throw new BadRequestException('The body is not a PNG image.');
    const maxWidth = Number(this.config.env.get('SCREENSHOT_MAX_WIDTH_PX'));
    if (info.width > maxWidth) throw new BadRequestException(`A screenshot is at most ${maxWidth} px wide (got ${info.width}).`);

    const key = screenshotKey(userId, session.id, order.id, kind);
    await repos.transaction(async (tx) => {
      const claimed = await tx.screenshots.insertIfAbsent({
        sessionId: session.id,
        orderId: order.id,
        kind,
        storeKey: key,
        widthPx: info.width,
        heightPx: info.height,
        bytes: bytes.length,
        capturedAtMs: capturedAt(order, kind, session),
      });
      if (!claimed) throw exists();
      try {
        await this.store.put(key, bytes, 'image/png');
      } catch (err) {
        this.logger.error(`screenshot store write failed for ${key}: ${(err as Error).message}`);
        throw new InternalServerErrorException('Could not store the screenshot. Try again.');
      }
    });
    return { key, width: info.width, height: info.height, bytes: bytes.length };
  }

  async get(userId: string, sessionId: string, orderId: string, kindRaw: string): Promise<Buffer> {
    const repos = this.requireEnabled();
    const kind = parseKind(kindRaw);
    const { order } = await this.resolve(repos, userId, sessionId, orderId);
    const row = await repos.screenshots.find(order.id, kind);
    if (!row) throw new NotFoundException('No such screenshot.');
    const object = await this.store.get(row.storeKey);
    if (!object) {
      this.logger.warn(`screenshot row ${row.id} has no object at ${row.storeKey}`);
      throw new NotFoundException('No such screenshot.');
    }
    return object.bytes;
  }

  /** 503 when the DB module is disabled. */
  assertEnabled(): void {
    this.requireEnabled();
  }

  private async resolve(repos: BacktestRepositories, userId: string, sessionId: string, orderId: string): Promise<{ session: SessionSummary; order: Order }> {
    const session = UuidSchema.safeParse(sessionId).success ? await repos.sessions.findById(userId, sessionId) : null;
    if (!session) throw sessionNotFound();
    const order = UuidSchema.safeParse(orderId).success ? await repos.orders.findById(session.id, orderId) : null;
    if (!order) throw new NotFoundException('Order not found.');
    return { session, order };
  }

  private requireEnabled(): BacktestRepositories {
    if (!this.repos) throw new ServiceUnavailableException('backtest disabled: DATABASE_URL not set');
    return this.repos;
  }
}

function parseKind(raw: string): ScreenshotKind {
  const parsed = ScreenshotKindSchema.safeParse(raw);
  if (!parsed.success) throw new BadRequestException("kind must be 'entry' or 'exit'.");
  return parsed.data;
}

function exists() {
  return apiError(HttpStatus.CONFLICT, 'SCREENSHOT_EXISTS', 'This screenshot was already uploaded; a screenshot is written once.');
}

/**
 * `captured_at_ms` is "the cursor at capture" (§3). The upload carries no time, so: an entry
 * picture is taken at placement (§9.2), i.e. at `placed_at_ms`; an exit picture right after the
 * advance that closed the order, whose best server-side stand-in is `exit_time_ms`, falling back
 * to the session cursor at upload time when the order is not closed (yet).
 */
function capturedAt(order: Order, kind: ScreenshotKind, session: SessionSummary): number {
  if (kind === 'entry') return order.placedAtMs;
  return order.exitTimeMs ?? session.cursorMs;
}

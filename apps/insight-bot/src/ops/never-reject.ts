/**
 * Anything that can record a line. Nest's `Logger` satisfies it structurally, and so does a
 * collector's injected logger port — the boundary must not require a framework to be safe.
 */
export interface ErrorSink {
  error(message: string): void;
}

/**
 * The boundary between a timer and an async body, which must never reject.
 *
 * ## Why this is a mechanism and not a rule
 *
 * A timer callback cannot await anything, so every scheduler in this app is written
 * `setInterval(() => void this.tick(), MS)`. `void` discards the promise, so a rejection becomes an
 * **unhandled promise rejection** — and since Node 15 the default for those is to **terminate the
 * process**. The whole bot: every collector, the news ingest, the DEX snapshots, the web API, the
 * member bot. One malformed venue response inside one tick body ends all of it.
 *
 * Found on 2026-10-13 from a real case rather than by reading: GoPlus answered with
 * `"result": null`, `Object.keys(null)` threw inside the DEX tick, and nothing between that throw
 * and `process.exit` would have said why. It would have presented as "the bot died overnight" with
 * no trace in the data.
 *
 * The containment already in the collectors is a different thing and does not cover this: it stops
 * **one source's failure from affecting the others**, by catching around each venue call. A throw in
 * the tick body itself — in the scheduling, the mapping, our own database — is outside every one of
 * those catches and takes the process down, so it affects every source at once. That makes it the
 * worst availability failure the system has available to it.
 *
 * Asking fifteen tick bodies to be individually exhaustive is a rule that needs discipline exactly
 * where discipline is lowest: in the error path nobody exercises. So the boundary itself refuses to
 * propagate, `scheduler-boundaries.spec.ts` fails the build if a new boundary skips it, and no tick
 * body has to be audited again.
 *
 * ## It records, loudly
 *
 * At ERROR with the label, because a tick that fails every time must not look like a tick that is
 * working. This is not a swallow: the alternative to logging is silence, and the alternative to
 * continuing is the process dying, so there is no option here that hides more than the others.
 */
export function neverReject(logger: ErrorSink, label: string, run: () => Promise<unknown>): void {
  // the try/catch is for a body that throws SYNCHRONOUSLY before returning a promise — a `.catch`
  // alone never sees that, and it is the likeliest shape for a mapping error
  try {
    void run().catch((error: unknown) => {
      logger.error(`${label} failed — ${describe(error)}`);
    });
  } catch (error) {
    logger.error(`${label} threw synchronously — ${describe(error)}`);
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

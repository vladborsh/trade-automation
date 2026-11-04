import { STREAM_ID } from '../../collectors/binance-perp/oi-ls.poller';
import { classifyGap } from '../../collectors/binance-perp/gap-classifier';
import type { Db } from '../../db/db.port';
import type { OiPoint } from './oi-per-bar';

/**
 * IB-110 — the one read both the chart (`/series/oi-divergences`) and the alert loop (IB-112) feed
 * the detector from: a symbol's stored 5 m OI over a window, and the slots in it that are NOT holes
 * because the venue did not publish them (IB-104's «биржа не публиковала», design V9). Read-only.
 *
 * **The window is `(fromSec, toSec]`**, matching the detector's ownership (a bar owns the readings
 * labelled `open < t ≤ close`, `oi-per-bar.ts`): pass the first bar's open and the last bar's close.
 *
 * **Venue silence** is the poller's own judgement, re-made here with the same rule and the same
 * population: an OPEN `collector_gaps` window of the OI/LS stream for this symbol, classified by
 * `classifyGap` against how many OTHER collected symbols (universe ∪ enabled alert list, as the
 * poller collects them) had OI stored in each of its slots. «poll failed» and «returned no rows» are
 * always ours — those stay holes, and the evaluation skips.
 *
 * A symbol with no stored rows comes back empty: the CALLER decides whether to ask the venue
 * (the chart does, for a coin we do not store; the alert loop never needs to).
 */
export interface OiWindow {
  oi5m: OiPoint[];
  /** Inclusive 5 m slot ranges (unix seconds) the venue did not publish. */
  venueSilent: Array<{ from: number; to: number }>;
}

const VENUE = 'binance';

export class OiWindowReader {
  constructor(private readonly db: Db) {}

  async read(symbol: string, fromSec: number, toSec: number): Promise<OiWindow> {
    const from = new Date(fromSec * 1000);
    const to = new Date(toSec * 1000);
    const rows = await this.db.query<{ ts: Date; oi_base: string | number }>(
      `select ts, oi_base from open_interest_5m where venue = $1 and symbol = $2 and ts > $3 and ts <= $4 order by ts`,
      [VENUE, symbol, from, to],
    );
    const oi5m = rows.map((r) => ({ time: Math.floor(new Date(r.ts).getTime() / 1000), oi: Number(r.oi_base) }));
    return { oi5m, venueSilent: await this.venueSilent(symbol, from, to) };
  }

  private async venueSilent(symbol: string, from: Date, to: Date): Promise<OiWindow['venueSilent']> {
    // the poller's population: what it collects now (universe ∪ enabled alert list), this symbol excluded
    const others = (await this.db.query<{ symbol: string }>(
      `select binance_perp as symbol from symbols where active
       union select symbol from alert_symbols where enabled`, [],
    )).map((r) => r.symbol).filter((s) => s !== symbol);
    const windows = await this.db.query<{ gap_from: Date; gap_to: Date; error: string | null; min_neighbours: string | number }>(
      `with w as (
         select distinct gap_from, gap_to, error
           from collector_gaps
          -- detected_at >= from is exact (a gap reaching into the window was detected after it ended), and prunes partitions
          where stream = $1 and symbol = $2 and repaired < expected and gap_to >= $3 and gap_from <= $4 and detected_at >= $3
       )
       select w.gap_from, w.gap_to, w.error,
              (select min((select count(*) from open_interest_5m o
                            where o.venue = $5 and o.ts = gs.slot and o.symbol = any($6)))
                 from generate_series(w.gap_from, w.gap_to, interval '5 minutes') as gs(slot)) as min_neighbours
         from w
        order by w.gap_from`,
      [STREAM_ID, symbol, from, to, VENUE, others],
    );
    return windows
      .filter((w) => classifyGap({ error: w.error, minNeighboursStored: Number(w.min_neighbours) }, others.length) === 'venue')
      .map((w) => ({ from: Math.floor(new Date(w.gap_from).getTime() / 1000), to: Math.floor(new Date(w.gap_to).getTime() / 1000) }));
  }
}

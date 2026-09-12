import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Subject } from 'rxjs';

/**
 * architecture/live-signal-server.md §4.6 — emits ticks at every 1m UTC boundary (+ a small
 * configurable offset for REST venues to allow the bar to settle). Used by CapitalComAdapter's
 * polling (which runs its own aligned timer today, §4.1) and by health checks: "a closed 1m
 * candle is late if none arrived within 15s of the boundary while the venue is open."
 */
@Injectable()
export class BarClock implements OnModuleDestroy {
  private readonly ticks = new Subject<number>();
  readonly tick$ = this.ticks.asObservable();
  private timer: NodeJS.Timeout | null = null;
  private readonly offsetMs = 1000;

  constructor() {
    this.scheduleNext();
  }

  private scheduleNext(): void {
    const now = Date.now();
    const msToBoundary = 60_000 - (now % 60_000) + this.offsetMs;
    this.timer = setTimeout(() => {
      this.ticks.next(Date.now());
      this.scheduleNext();
    }, msToBoundary);
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.ticks.complete();
  }
}

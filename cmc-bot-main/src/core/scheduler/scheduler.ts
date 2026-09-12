import { Observable, defer, share, switchMap, timer } from 'rxjs';

export class TimerScheduler {
  private _sharedTimer$?: Observable<number>;

  public getTimer(): Observable<number> {
    if (!this._sharedTimer$) {
      this._sharedTimer$ = defer(() => {
        const delay = this.delayUntilNextMinute();

        return timer(delay, 60_000).pipe(
          switchMap(() => [Date.now()]),
          share()
        );
      });
    }

    return this._sharedTimer$;
  }

  private delayUntilNextMinute(): number {
    const now = new Date();
    return 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
  }
}

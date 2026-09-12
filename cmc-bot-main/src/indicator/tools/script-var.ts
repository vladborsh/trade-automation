import { Subject } from 'rxjs';

export class ScriptVar<T> {
  iteration = 0;
  history: T[] = [];
  lastUpdateIteration = 0;

  constructor(value: T, onIterationStart$: Subject<number>, onIterationEnd$: Subject<number>) {
    this.history.push(value);
    onIterationStart$.subscribe((iteration: number) => (this.iteration = iteration));
    onIterationEnd$.subscribe(() => this.endFn());
  }

  public slice(length: number) {
    return this.history.slice(length);
  }

  public get length() {
    return this.history.length;
  }

  /* push to the end new value */
  public set(value: T): void {
    if (this.lastUpdateIteration < this.iteration) {
      this.history.push(value);
      this.lastUpdateIteration = this.iteration;
    } else {
      this.history[this.history.length - this.iteration - 1] = value;
    }
  }

  /* if during iteration value was't change, add lasted to list */
  public endFn() {
    if (this.lastUpdateIteration < this.iteration) {
      this.history.push(this.history[this.history.length - 1]);
      this.lastUpdateIteration = this.iteration;
    }
  }

  /* returns i element from the end (how pinescirpt works) */
  public get(index: number = 0): T {
    return this.history[this.history.length - 1 - index];
  }
}

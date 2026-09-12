import { Subject } from 'rxjs';
import { ScriptVar } from './script-var';

export class ScriptVarFactory {
  constructor(
    private onIteration$: Subject<number>,
    private onIterationEnd$: Subject<number>
  ) {}

  var<T>(initial: T): ScriptVar<T> {
    return new ScriptVar(initial, this.onIteration$, this.onIterationEnd$);
  }
}

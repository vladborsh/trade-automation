/**
 * IB-109 (design V5), IB-141 (V34) — the owner's pivot rule, word for word. Pure.
 *
 * Bar *i* is a **low** when `v[i] < v[j]` for the `nLeft` bars before it and `v[i] ≤ v[j]` for the `nRight` bars
 * after. Strict on the left, not on the right: of two equal bars the FIRST is the pivot and the second is not (its
 * left side holds an equal value), so a double bottom keeps its first bottom. Highs mirror it. A pivot exists only
 * once bar i + nRight has closed — that is its confirmation. A window touching a missing value (null) has no pivot:
 * an unknown neighbour could be lower.
 *
 * The two sides differ on 4h since IB-141 (6 left, 2 right): `nLeft` is how far back a pivot looks, `nRight` how
 * long it waits.
 */
export type Side = 'low' | 'high';

export function pivots(values: ReadonlyArray<number | null>, nLeft: number, nRight: number, side: Side): number[] {
  const out: number[] = [];
  const beats = side === 'low' ? (a: number, b: number) => a < b : (a: number, b: number) => a > b;
  const ties = side === 'low' ? (a: number, b: number) => a <= b : (a: number, b: number) => a >= b;
  for (let i = nLeft; i + nRight < values.length; i++) {
    const v = values[i];
    if (v === null) continue;
    let ok = true;
    for (let j = i - nLeft; j < i && ok; j++) ok = values[j] !== null && beats(v, values[j] as number);
    for (let j = i + 1; j <= i + nRight && ok; j++) ok = values[j] !== null && ties(v, values[j] as number);
    if (ok) out.push(i);
  }
  return out;
}

/**
 * A set of ids `0 .. keys.length − 1`, each with a fixed numeric key known up front, supporting
 * insert, remove and "take every member whose key lies strictly inside (lo, hi)" in O(log n) per
 * id touched — so a run of n inserts, n removals and any number of takes is O(n log n) overall.
 * Built for `ifvgSeries` (T-034), whose FVG boxes are all detectable before the scan: an
 * inversion removes every live box with its edge strictly between a bar's open and close.
 *
 * The ids are laid out in key order; a count tree over those positions finds the next live one in
 * O(log n), skipping dead ones.
 */
const NONE: readonly number[] = [];

export class KeyedSet {
  private readonly idAt: Int32Array; // position (key order) → id
  private readonly posOf: Int32Array; // id → position
  private readonly sorted: Float64Array; // key at each position, ascending
  private readonly size: number; // leaves of the count tree (a power of two ≥ keys.length)
  private readonly count: Int32Array; // count tree: node k covers leaves under it; leaves at size..2·size−1

  constructor(keys: ArrayLike<number>) {
    const n = keys.length;
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => keys[a] - keys[b] || a - b);
    this.idAt = Int32Array.from(order);
    this.posOf = new Int32Array(n);
    this.sorted = new Float64Array(n);
    order.forEach((id, pos) => {
      this.posOf[id] = pos;
      this.sorted[pos] = keys[id];
    });
    let size = 1;
    while (size < n) size *= 2;
    this.size = size;
    this.count = new Int32Array(2 * size);
  }

  has(id: number): boolean {
    return this.count[this.size + this.posOf[id]] === 1;
  }

  insert(id: number): void {
    if (!this.has(id)) this.add(this.posOf[id], 1);
  }

  remove(id: number): void {
    if (this.has(id)) this.add(this.posOf[id], -1);
  }

  /** Removes and returns (in ascending id order) every member with `lo < key < hi`. */
  takeBetween(lo: number, hi: number): readonly number[] {
    if (!(lo < hi) || this.count[1] === 0) return NONE; // most calls: nothing can be inside
    let pos = this.nextLive(this.firstAbove(lo));
    if (pos < 0 || this.sorted[pos] >= hi) return NONE;
    const taken: number[] = [];
    for (; pos >= 0 && this.sorted[pos] < hi; pos = this.nextLive(pos + 1)) taken.push(this.idAt[pos]);
    if (taken.length === 0) return NONE;
    for (const id of taken) this.add(this.posOf[id], -1);
    return taken.length > 1 ? taken.sort((a, b) => a - b) : taken;
  }

  private add(pos: number, delta: number): void {
    for (let k = this.size + pos; k >= 1; k >>= 1) this.count[k] += delta;
  }

  /** The first position whose key is > `key` (keys.length if none). */
  private firstAbove(key: number): number {
    let lo = 0;
    let hi = this.sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.sorted[mid] > key) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  /** The first live position ≥ `pos`, or -1: up the count tree to a live right sibling, then down. */
  private nextLive(pos: number): number {
    if (pos >= this.sorted.length) return -1;
    let node = this.size + pos;
    if (this.count[node] === 0) {
      for (;;) {
        if (node === 1) return -1;
        if ((node & 1) === 0 && this.count[node + 1] > 0) {
          node++;
          break;
        }
        node >>= 1;
      }
      while (node < this.size) node = this.count[2 * node] > 0 ? 2 * node : 2 * node + 1;
    }
    return node - this.size;
  }
}

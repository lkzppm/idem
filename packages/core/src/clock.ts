/**
 * Time source used by every IDEM component. Production uses {@link RealClock}; the simulator and
 * tests use {@link VirtualClock}, so behavior is deterministic for a given seed.
 */
export interface Clock {
  /** Milliseconds. Epoch time for {@link RealClock}, virtual time otherwise. */
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Wall-clock time and the platform timers. */
export class RealClock implements Clock {
  now(): number {
    return Date.now();
  }
  setTimeout(fn: () => void, ms: number): unknown {
    return globalThis.setTimeout(fn, ms);
  }
  clearTimeout(handle: unknown): void {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  }
}

interface Timer {
  at: number;
  seq: number;
  fn: () => unknown;
  cancelled: boolean;
}

/**
 * Discrete-event clock. Timers run in `(time, insertion order)` order, one at a time; if a timer
 * callback returns a promise, the clock awaits it before running the next timer. Async work
 * (e.g. WebCrypto) therefore never reorders events, which keeps simulations deterministic.
 */
export class VirtualClock implements Clock {
  #now: number;
  #seq = 0;
  #heap: Timer[] = [];

  constructor(start = 0) {
    this.#now = start;
  }

  now(): number {
    return this.#now;
  }

  setTimeout(fn: () => unknown, ms: number): unknown {
    const t: Timer = { at: this.#now + Math.max(0, ms), seq: this.#seq++, fn, cancelled: false };
    this.#push(t);
    return t;
  }

  clearTimeout(handle: unknown): void {
    if (handle && typeof handle === "object" && "cancelled" in handle) (handle as Timer).cancelled = true;
  }

  /** Number of scheduled (possibly cancelled) timers. */
  get pending(): number {
    return this.#heap.length;
  }

  /** Time of the next live timer, or `undefined` if none. */
  nextAt(): number | undefined {
    this.#dropCancelled();
    return this.#heap[0]?.at;
  }

  /** Run the next timer, awaiting its result. Returns `false` when no timer is left. */
  async step(): Promise<boolean> {
    this.#dropCancelled();
    const t = this.#pop();
    if (!t) return false;
    this.#now = Math.max(this.#now, t.at);
    const r = t.fn();
    if (r && typeof (r as PromiseLike<unknown>).then === "function") await r;
    return true;
  }

  /** Run every timer due at or before `time`, then advance the clock to `time`. */
  async runUntil(time: number): Promise<void> {
    for (let next = this.nextAt(); next !== undefined && next <= time; next = this.nextAt()) {
      await this.step();
    }
    this.#now = Math.max(this.#now, time);
  }

  /** Run until no timer is left (or `maxSteps` timers ran). Returns the number of steps. */
  async runAll(maxSteps = 10_000_000): Promise<number> {
    let n = 0;
    while (n < maxSteps && (await this.step())) n++;
    return n;
  }

  #dropCancelled(): void {
    while (this.#heap.length > 0 && (this.#heap[0] as Timer).cancelled) this.#pop();
  }

  #less(a: Timer, b: Timer): boolean {
    return a.at < b.at || (a.at === b.at && a.seq < b.seq);
  }

  #push(t: Timer): void {
    const h = this.#heap;
    h.push(t);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.#less(h[i] as Timer, h[p] as Timer)) break;
      [h[i], h[p]] = [h[p] as Timer, h[i] as Timer];
      i = p;
    }
  }

  #pop(): Timer | undefined {
    const h = this.#heap;
    if (h.length === 0) return undefined;
    const top = h[0] as Timer;
    const last = h.pop() as Timer;
    if (h.length > 0) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && this.#less(h[l] as Timer, h[m] as Timer)) m = l;
        if (r < h.length && this.#less(h[r] as Timer, h[m] as Timer)) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m] as Timer, h[i] as Timer];
        i = m;
      }
    }
    return top;
  }
}

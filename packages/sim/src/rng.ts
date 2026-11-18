/**
 * Seeded pseudo-random generator (sfc32 seeded through splitmix32). Every random decision in a
 * simulation comes from an {@link Rng} derived from the run seed, so runs are reproducible.
 */
export class Rng {
  #a: number;
  #b: number;
  #c: number;
  #d: number;

  constructor(seed: number) {
    let s = seed >>> 0;
    const next = () => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.#a = next();
    this.#b = next();
    this.#c = next();
    this.#d = next();
    for (let i = 0; i < 12; i++) this.uint32();
  }

  /** Uniform 32-bit unsigned integer. */
  uint32(): number {
    const t = (((this.#a + this.#b) >>> 0) + this.#d) >>> 0;
    this.#d = (this.#d + 1) >>> 0;
    this.#a = this.#b ^ (this.#b >>> 9);
    this.#b = (this.#c + (this.#c << 3)) >>> 0;
    this.#c = ((this.#c << 21) | (this.#c >>> 11)) >>> 0;
    this.#c = (this.#c + t) >>> 0;
    return t;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.uint32() / 4294967296;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Exponential with the given mean. */
  exp(mean: number): number {
    return -Math.log(1 - this.next()) * mean;
  }

  /** Standard normal (Box–Muller). */
  normal(): number {
    const u = 1 - this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Log-normal: `exp(mu + sigma·N(0,1))`. */
  lognormal(mu: number, sigma: number): number {
    return Math.exp(mu + sigma * this.normal());
  }

  /** `n` random bytes. */
  bytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = this.uint32() & 0xff;
    return out;
  }

  /** A derived, independent generator (stable for a given label). */
  fork(label: string): Rng {
    let h = 2166136261;
    for (let i = 0; i < label.length; i++) h = Math.imul(h ^ label.charCodeAt(i), 16777619);
    return new Rng((this.uint32() ^ h) >>> 0);
  }
}

/** Zipf sampler over ranks `0 .. n-1` with exponent `alpha` (alpha = 0 is uniform). */
export class Zipf {
  readonly #cdf: Float64Array;

  constructor(n: number, alpha: number) {
    this.#cdf = new Float64Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += 1 / (i + 1) ** alpha;
      this.#cdf[i] = sum;
    }
    for (let i = 0; i < n; i++) (this.#cdf as Float64Array)[i] = (this.#cdf[i] as number) / sum;
  }

  sample(rng: Rng): number {
    const u = rng.next();
    let lo = 0;
    let hi = this.#cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.#cdf[mid] as number) < u) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

/** Percentile (nearest-rank) of an unsorted list; `NaN` when empty. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank] as number;
}

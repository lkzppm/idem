/**
 * CPU cost of the IDEM operations as a function of payload size. The virtual clock does not see
 * real CPU time, so a simulation charges these as explicit delays; the values are measured by E1
 * (05-evaluation §4) and frozen in the experiment config, which keeps E2 deterministic.
 */
export interface ProcessingCosts {
  /** Payload sizes in bytes, strictly ascending, at which the costs below were measured. */
  sizesBytes: number[];
  /** `canonicalizeArgs`, microseconds per call, one value per size (size = argument bytes). */
  canonicalizeUs: number[];
  /** `makeName`, microseconds per call (size = canonical argument bytes). */
  nameUs: number[];
  /** `signData`, microseconds per call (size = result bytes). */
  signUs: number[];
  /** `verifyData`, microseconds per call (size = result bytes). */
  verifyUs: number[];
}

/** The four operations a {@link ProcessingCosts} table prices. */
export type ProcessingOp = "canonicalizeUs" | "nameUs" | "signUs" | "verifyUs";

/**
 * Cost in microseconds of one operation on a payload of `bytes`: linear interpolation between
 * the two measured sizes that bracket it. Below the smallest measured size the smallest size's
 * cost is charged (an overestimate for tiny arguments); above the largest, the last segment is
 * extended.
 */
export function costUs(costs: ProcessingCosts, op: ProcessingOp, bytes: number): number {
  const xs = costs.sizesBytes;
  const ys = costs[op];
  const n = xs.length;
  if (n === 0) return 0;
  const first = ys[0] as number;
  if (n === 1 || bytes <= (xs[0] as number)) return first;
  let i = 1;
  while (i < n - 1 && bytes > (xs[i] as number)) i++;
  const x0 = xs[i - 1] as number;
  const x1 = xs[i] as number;
  const y0 = ys[i - 1] as number;
  const y1 = ys[i] as number;
  return Math.max(0, y0 + ((y1 - y0) * (bytes - x0)) / (x1 - x0));
}

/** Throws unless `c` is a well-formed cost table. */
export function assertProcessingCosts(c: ProcessingCosts): void {
  const n = c.sizesBytes.length;
  if (n === 0) throw new Error("processing: sizesBytes is empty");
  for (let i = 1; i < n; i++) {
    if (!((c.sizesBytes[i] as number) > (c.sizesBytes[i - 1] as number))) {
      throw new Error("processing: sizesBytes must be strictly ascending");
    }
  }
  for (const op of ["canonicalizeUs", "nameUs", "signUs", "verifyUs"] as const) {
    const ys = c[op];
    if (!Array.isArray(ys) || ys.length !== n) throw new Error(`processing: ${op} needs ${n} values`);
    if (!ys.every((y) => Number.isFinite(y) && y >= 0)) throw new Error(`processing: ${op} has a bad value`);
  }
}

import type { Measurement } from "./measure.js";

export interface CircuitCost extends Measurement {
  /** Rows the prover works over: 2^k. */
  capacity: number;
  /** Cost relative to the cheapest circuit in this contract. */
  relativeCost: number;
}

/**
 * Derive the reportable numbers.
 *
 * `k` is read from zkir and never recomputed. It is not a function of `rows`:
 * equal row counts have been observed at different `k`, and higher row counts
 * at lower `k`. Any local formula would be confidently wrong, so the only
 * derived values here are the ones that follow from `k` itself.
 */
export function analyze(measurements: Measurement[]): CircuitCost[] {
  if (measurements.length === 0) return [];

  const lowestK = Math.min(...measurements.map((m) => m.k));

  return measurements.map((m) => ({
    ...m,
    capacity: 2 ** m.k,
    relativeCost: 2 ** (m.k - lowestK),
  }));
}

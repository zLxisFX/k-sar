function finiteParameter(name: string, value: number, nonnegative = false): void {
  if (!Number.isFinite(value) || (nonnegative && value < 0)) throw new RangeError(`${name} must be finite${nonnegative ? " and nonnegative" : ""}.`);
}

/** Subsidence-only sensitivity equation: E_model = E_DSM - |rate| * years / 1000.
 * Either sign expresses the magnitude of lowering; this function does not model uplift.
 * Rate and elapsed time are assumed inputs, not measured land motion or pixel epochs.
 */
export function correctedElevation(elevationMeters: number | null, rateMmPerYear: number, elapsedYears: number): number | null {
  finiteParameter("Subsidence rate", rateMmPerYear);
  finiteParameter("Elapsed years", elapsedYears, true);
  if (elevationMeters === null || !Number.isFinite(elevationMeters)) return null;
  return elevationMeters - Math.abs(rateMmPerYear) * elapsedYears / 1000;
}

/** Both heights must use the same EGM2008 vertical reference. No gauge conversion is implied. */
export function scenarioDepth(waterSurfaceMeters: number, surfaceMeters: number | null): number | null {
  finiteParameter("Water surface", waterSurfaceMeters);
  if (surfaceMeters === null || !Number.isFinite(surfaceMeters)) return null;
  return Math.max(0, waterSurfaceMeters - surfaceMeters);
}

/** A screening cutoff, not verified vehicle passability. Unknown depths stay unknown. */
export function isScenarioClosed(depthMeters: number | null, cutoffMeters = 0.30): boolean | null {
  finiteParameter("Closure cutoff", cutoffMeters, true);
  if (depthMeters === null || !Number.isFinite(depthMeters)) return null;
  if (depthMeters < 0) throw new RangeError("Depth must be nonnegative.");
  return depthMeters > cutoffMeters;
}

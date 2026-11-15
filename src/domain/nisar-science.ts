import { assertAlignedGrids, backscatterChangeDb, sampleRasterWgs84 } from "./raster.ts";
import type { DecodedRaster } from "./raster.ts";

export type NisarPolarization = "HH" | "HV";
export type NisarSciencePair = {
  before: DecodedRaster;
  after: DecodedRaster;
  change: DecodedRaster;
};
export type BackscatterPair = { before: number | null; after: number | null; delta: number | null };
export type NisarScienceSample = { HH: BackscatterPair; HV: BackscatterPair };
export type ChangeDistribution = {
  validPixels: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  histogram: { edges: number[]; counts: number[] };
};

export function validateSciencePair(pair: NisarSciencePair): void {
  assertAlignedGrids(pair.before, pair.after, pair.change);
  if ([pair.before, pair.after, pair.change].some(raster => raster.bandCount !== 2)) {
    throw new RangeError("NISAR science rasters require HH and HV Float32 bands, in that order.");
  }
}

export function sampleScience(pair: NisarSciencePair | null, lon: number, lat: number): NisarScienceSample {
  const sample = (band: number): BackscatterPair => {
    const before = pair ? sampleRasterWgs84(pair.before, lon, lat, band) : null;
    const after = pair ? sampleRasterWgs84(pair.after, lon, lat, band) : null;
    return { before, after, delta: backscatterChangeDb(before, after) };
  };
  return { HH: sample(0), HV: sample(1) };
}

export function radarRgba(raster: DecodedRaster, band: number, range: readonly [number, number], difference = false): Uint8ClampedArray {
  if (!Number.isInteger(band) || band < 0 || band >= raster.bandCount) throw new RangeError("Invalid radar band.");
  const [low, high] = range;
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low || (difference && (low >= 0 || high <= 0))) {
    throw new RangeError("Invalid radar display range.");
  }
  const pixels = new Uint8ClampedArray(raster.width * raster.height * 4);
  const neutral = [245, 246, 239], negative = [36, 111, 120], positive = [165, 78, 39];
  for (let index = 0; index < raster.bands[band].length; index++) {
    const value = raster.bands[band][index];
    if (!Number.isFinite(value) || value === raster.noData) continue;
    const offset = index * 4;
    if (difference) {
      const end = value < 0 ? negative : positive;
      const fraction = Math.min(1, value < 0 ? value / low : value / high);
      for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = Math.round(neutral[channel] + fraction * (end[channel] - neutral[channel]));
    } else {
      const grey = Math.round(Math.max(0, Math.min(1, (value - low) / (high - low))) * 255);
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = grey;
    }
    pixels[offset + 3] = 255;
  }
  return pixels;
}

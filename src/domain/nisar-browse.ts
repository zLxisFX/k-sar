import { pixelAtWgs84 } from "./raster.ts";

export type BrowseGrid = {
  crs: string;
  width: number;
  height: number;
  pixelSizeMeters: number;
  transform: number[];
  boundsMeters: number[];
  boundsWgs84: { west: number; south: number; east: number; north: number };
};
export type BrowseImage = {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
};
export type BrowsePair = readonly [BrowseImage, BrowseImage];
export type BrowseSample = {
  rgb: [number, number, number];
  brightness: number;
  column: number;
  row: number;
};
export type RadarSource = "sentinel-1" | "nisar";
export type NisarDisplay = "pair" | "difference";

export function displayBrightness(rgb: readonly number[]): number {
  return Math.floor(
    (2126 * rgb[0] + 7152 * rgb[1] + 722 * rgb[2] + 5000) / 10000,
  );
}

export function sampleBrowse(
  image: BrowseImage,
  grid: BrowseGrid,
  lon: number,
  lat: number,
): BrowseSample | null {
  if (grid.crs !== "EPSG:3857")
    throw new RangeError("Browse sampling requires EPSG:3857.");
  if (
    image.width !== grid.width ||
    image.height !== grid.height ||
    image.rgba.length !== grid.width * grid.height * 4
  )
    throw new RangeError(
      "Browse image dimensions differ from the common grid.",
    );
  const pixel = pixelAtWgs84(
    {
      ...grid,
      transform: grid.transform as [
        number,
        number,
        number,
        number,
        number,
        number,
      ],
      pixelSizeMeters: [grid.pixelSizeMeters, grid.pixelSizeMeters],
      noData: null,
    },
    lon,
    lat,
  );
  if (!pixel) return null;
  const offset = (pixel.row * grid.width + pixel.column) * 4;
  if (image.rgba[offset + 3] !== 255) return null;
  const rgb: [number, number, number] = [
    image.rgba[offset],
    image.rgba[offset + 1],
    image.rgba[offset + 2],
  ];
  return { ...pixel, rgb, brightness: displayBrightness(rgb) };
}

export function aggregateHistogram(counts: readonly number[], groupSize = 8) {
  if (
    counts.length !== 511 ||
    !Number.isInteger(groupSize) ||
    groupSize < 1 ||
    counts.some((count) => !Number.isInteger(count) || count < 0)
  )
    throw new RangeError(
      "Expected 511 nonnegative counts for display changes −255 through +255.",
    );
  return Array.from(
    { length: Math.ceil(counts.length / groupSize) },
    (_, index) => {
      const start = index * groupSize;
      return {
        low: start - 255,
        high: Math.min(start + groupSize - 1, 510) - 255,
        count: counts
          .slice(start, start + groupSize)
          .reduce((sum, count) => sum + count, 0),
      };
    },
  );
}

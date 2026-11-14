import { fromArrayBuffer } from "geotiff";
import type { RasterGrid } from "./geospatial.ts";

export type DecodedRaster = RasterGrid & {
  bandCount: number;
  bands: readonly Float32Array[];
  dataType: "float32";
  boundsMeters: readonly [left: number, bottom: number, right: number, top: number];
};

/** Decode the actual north-up Web Mercator research TIFF, without radiometric conversion.
 * Sentinel baseline/post pixels are already gamma-naught dB; band 0 is VV and
 * band 1 is VH. The DSM's one band contains EGM2008 surface heights in metres.
 */
export async function decodeRaster(bytes: ArrayBuffer | Uint8Array): Promise<DecodedRaster> {
  // Copy a view's exact byte range; a Node Buffer can share a much larger backing store.
  const buffer = bytes instanceof Uint8Array ? new Uint8Array(bytes).buffer : bytes;
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const geoKeys = image.getGeoKeys();
  if (geoKeys?.ProjectedCSTypeGeoKey !== 3857) {
    throw new Error("This raster reader requires EPSG:3857 coordinates.");
  }
  if (geoKeys.GTRasterTypeGeoKey !== 1 || image.fileDirectory.hasTag("ModelTransformation")) {
    throw new Error("Only north-up PixelIsArea rasters with origin/scale georeferencing are supported.");
  }
  const width = image.getWidth(), height = image.getHeight();
  const bandCount = image.getSamplesPerPixel();
  const [originX, originY] = image.getOrigin();
  const [pixelX, pixelY] = image.getResolution();
  if (![width, height, bandCount].every((n) => Number.isInteger(n) && n > 0)
      || ![originX, originY, pixelX, pixelY].every(Number.isFinite)
      || pixelX <= 0 || pixelY >= 0) {
    throw new Error("Invalid north-up raster dimensions or transform.");
  }
  for (let band = 0; band < bandCount; band++) {
    if (image.getSampleFormat(band) !== 3 || image.getBitsPerSample(band) !== 32) {
      throw new Error("The research data contract requires Float32 bands.");
    }
  }
  const decoded = await image.readRasters({ interleave: false });
  const bands = Array.from(decoded, (band) => {
    if (!(band instanceof Float32Array) || band.length !== width * height) {
      throw new Error("Decoded band does not match its Float32 grid.");
    }
    return band;
  });
  if (bands.length !== bandCount) throw new Error("Decoded band count differs from TIFF metadata.");
  return {
    width, height, bandCount, bands, dataType: "float32", crs: "EPSG:3857",
    pixelSizeMeters: [pixelX, Math.abs(pixelY)],
    transform: [pixelX, 0, originX, 0, pixelY, originY],
    noData: image.getGDALNoData(),
    boundsMeters: [originX, originY + pixelY * height, originX + pixelX * width, originY],
  };
}

/** Alignment is required before pixel-by-pixel comparison; resampling is never implicit. */
export function assertAlignedGrids(first: RasterGrid, ...others: RasterGrid[]): void {
  for (const grid of [first, ...others]) {
    if (!Number.isInteger(grid.width) || !Number.isInteger(grid.height)
        || grid.width <= 0 || grid.height <= 0 || !grid.transform.every(Number.isFinite)
        || !grid.pixelSizeMeters.every((n) => Number.isFinite(n) && n > 0)) {
      throw new Error("Invalid raster grid metadata.");
    }
    if (grid.width !== first.width || grid.height !== first.height || grid.crs !== first.crs
        || grid.transform.some((n, i) => Math.abs(n - first.transform[i]) > 1e-8)
        || grid.pixelSizeMeters.some((n, i) => Math.abs(n - first.pixelSizeMeters[i]) > 1e-8)) {
      throw new Error("Raster grids are not aligned.");
    }
  }
}

export function pixelAtWgs84(grid: RasterGrid, lon: number, lat: number): { column: number; row: number } | null {
  if (grid.crs !== "EPSG:3857" || grid.transform[1] !== 0 || grid.transform[3] !== 0
      || grid.transform[0] <= 0 || grid.transform[4] >= 0) {
    throw new Error("WGS84 sampling requires a north-up EPSG:3857 grid.");
  }
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 85.0511287798066) return null;
  const x = 6378137 * lon * Math.PI / 180;
  const y = 6378137 * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  const column = Math.floor((x - grid.transform[2]) / grid.transform[0]);
  const row = Math.floor((y - grid.transform[5]) / grid.transform[4]);
  if (column < 0 || row < 0 || column >= grid.width || row >= grid.height) return null;
  return { column, row };
}

/** Nodata and out-of-extent samples remain unknown; they are never clamped to an edge. */
export function sampleRasterPixel(raster: DecodedRaster, column: number, row: number, bandIndex = 0): number | null {
  if (!Number.isInteger(bandIndex) || bandIndex < 0 || bandIndex >= raster.bandCount) throw new RangeError("Invalid band index.");
  if (!Number.isInteger(column) || !Number.isInteger(row) || column < 0 || row < 0 || column >= raster.width || row >= raster.height) return null;
  const value = raster.bands[bandIndex][row * raster.width + column];
  return !Number.isFinite(value) || value === raster.noData ? null : value;
}

export function sampleRasterWgs84(raster: DecodedRaster, lon: number, lat: number, bandIndex = 0): number | null {
  const pixel = pixelAtWgs84(raster, lon, lat);
  return pixel ? sampleRasterPixel(raster, pixel.column, pixel.row, bandIndex) : null;
}

/** Subtract dB observations directly. A second logarithm would corrupt these values. */
export function backscatterChangeDb(before: number | null, after: number | null): number | null {
  return before === null || after === null || !Number.isFinite(before) || !Number.isFinite(after) ? null : after - before;
}

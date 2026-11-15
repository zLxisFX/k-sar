import test from "node:test";
import assert from "node:assert/strict";
import { radarRgba, sampleScience, validateSciencePair } from "../src/domain/nisar-science.ts";
import type { DecodedRaster } from "../src/domain/raster.ts";

const raster = (bands: number[][], noData = NaN): DecodedRaster => ({
  width: 3, height: 1, bandCount: bands.length,
  bands: bands.map(values => Float32Array.from(values)),
  dataType: "float32", crs: "EPSG:3857", noData,
  pixelSizeMeters: [30, 30], transform: [30, 0, 0, 0, -30, 30], boundsMeters: [0, 0, 90, 30],
});

test("calibrated inspection preserves dates and polarizations and never assigns change to missing support", () => {
  const pair = {
    before: raster([[-10, NaN, -20], [-30, -25, NaN]]),
    after: raster([[-7, -15, NaN], [-32, NaN, -22]]),
    change: raster([[3, NaN, NaN], [-2, NaN, NaN]]),
  };
  validateSciencePair(pair);
  assert.deepEqual(sampleScience(pair, .0001, .0001), { HH: { before: -10, after: -7, delta: 3 }, HV: { before: -30, after: -32, delta: -2 } });
  assert.deepEqual(sampleScience(pair, .0004, .0001), { HH: { before: null, after: -15, delta: null }, HV: { before: -25, after: null, delta: null } });
  assert.equal(sampleScience(pair, 121, 14).HH.before, null);
  assert.throws(() => validateSciencePair({ ...pair, after: { ...pair.after, transform: [30, 0, 1, 0, -30, 30] } }), /aligned/);
  assert.throws(() => validateSciencePair({ ...pair, before: raster([[-10, -15, -20]]) }), /HH and HV/);
});

test("radar rendering keeps nodata transparent and display clipping cannot modify calibrated pixels", () => {
  const source = raster([[-100, NaN, 100], [-6, 0, 6]]);
  const original = source.bands.map(values => values.slice());
  assert.deepEqual([...radarRgba(source, 0, [-25, 5])], [0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255]);
  assert.deepEqual([...radarRgba(source, 1, [-6, 6], true)], [36, 111, 120, 255, 245, 246, 239, 255, 165, 78, 39, 255]);
  assert.deepEqual(source.bands, original);
  assert.equal(radarRgba(raster([[-9999, 0, 1]], -9999), 0, [-25, 5])[3], 0);
  assert.throws(() => radarRgba(source, 2, [-25, 5]), /band/);
  assert.throws(() => radarRgba(source, 0, [0, 0]), /range/);
});

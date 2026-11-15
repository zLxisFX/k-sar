import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateHistogram,
  displayBrightness,
  sampleBrowse,
} from "../src/domain/nisar-browse.ts";

const grid = {
  crs: "EPSG:3857",
  width: 2,
  height: 2,
  pixelSizeMeters: 200,
  boundsMeters: [0, -200, 400, 200],
  boundsWgs84: { west: 0, east: 1, south: -1, north: 1 },
  transform: [200, 0, 0, 0, -200, 200],
};
const image = {
  width: 2,
  height: 2,
  rgba: new Uint8ClampedArray([
    10, 20, 30, 255, 80, 90, 100, 0, 40, 50, 60, 255, 255, 255, 255, 255,
  ]),
};
test("common-grid sampling preserves north-up indexing, RGB and masked/outside cells", () => {
  const first = sampleBrowse(image, grid, 0.0005, 0.0005)!;
  assert.deepEqual(first.rgb, [10, 20, 30]);
  assert.deepEqual([first.column, first.row], [0, 0]);
  assert.equal(first.brightness, 19);
  assert.equal(sampleBrowse(image, grid, 0.002, 0.0005), null);
  assert.equal(sampleBrowse(image, grid, -0.001, 0), null);
  assert.deepEqual(
    sampleBrowse(image, grid, 0.0005, -0.0005)?.rgb,
    [40, 50, 60],
  );
  assert.throws(() => sampleBrowse({ ...image, width: 1 }, grid, 0, 0));
  assert.throws(() => sampleBrowse(image, { ...grid, crs: "EPSG:4326" }, 0, 0));
  assert.equal(displayBrightness([255, 255, 255]), 255);
});
test("histogram grouping retains all 511 signed bins and their cell count", () => {
  const counts = Array.from({ length: 511 }, (_, i) => i % 7);
  const bins = aggregateHistogram(counts);
  assert.equal(bins[0].low, -255);
  assert.equal(bins.at(-1)!.high, 255);
  assert.equal(
    bins.reduce((sum, bin) => sum + bin.count, 0),
    counts.reduce((sum, count) => sum + count, 0),
  );
  assert.throws(() => aggregateHistogram([1, 2]));
  assert.throws(() => aggregateHistogram(counts, 0));
});

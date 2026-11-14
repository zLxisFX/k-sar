import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { decodeRaster, sampleRasterWgs84, sampleRasterPixel, pixelAtWgs84, assertAlignedGrids, backscatterChangeDb } from "../src/domain/raster.ts";
import type { DecodedRaster } from "../src/domain/raster.ts";

const dataUrl = new URL("../data/sentinel-1/", import.meta.url);
const files = ["baseline.tif", "post.tif", "dem.tif"] as const;
const expectedHashes = [
  "0f035f4b14488d27c45c7d88744503b23c12ac32f6145b1b1af56006115475f4",
  "24473d762dcd2de5dbf227e3d0ce043b32b3d46f4ce767076cda1e21e5e21f0c",
  "39ee1d9afa27ffbf5a552566253e646a740416c3b86cac61db79209dbaec2a86",
];
// One actual decode per file, shared by independent invariant tests.
const loaded = Promise.all(files.map(async (file) => {
  const bytes = await readFile(new URL(file, dataUrl));
  return { bytes, raster: await decodeRaster(bytes) };
}));

// Independent WGS84 ellipsoidal inverse calculation (Vincenty) for the short
// reference transect. It does not reuse projected TIFF distances or saved totals.
function geodesicMeters(a: readonly number[], b: readonly number[]): number {
  const semiMajor = 6378137, flattening = 1 / 298.257223563;
  const semiMinor = semiMajor * (1 - flattening), radians = Math.PI / 180;
  const u1 = Math.atan((1 - flattening) * Math.tan(a[1] * radians));
  const u2 = Math.atan((1 - flattening) * Math.tan(b[1] * radians));
  const longitude = (b[0] - a[0]) * radians;
  let lambda = longitude, sigma = 0, sinSigma = 0, cosSigma = 0, cosSquaredAlpha = 0, cos2SigmaM = 0;
  let converged = false;
  for (let iteration = 0; iteration < 100; iteration++) {
    sinSigma = Math.hypot(Math.cos(u2) * Math.sin(lambda), Math.cos(u1) * Math.sin(u2) - Math.sin(u1) * Math.cos(u2) * Math.cos(lambda));
    if (sinSigma === 0) return 0;
    cosSigma = Math.sin(u1) * Math.sin(u2) + Math.cos(u1) * Math.cos(u2) * Math.cos(lambda);
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = Math.cos(u1) * Math.cos(u2) * Math.sin(lambda) / sinSigma;
    cosSquaredAlpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cosSquaredAlpha === 0 ? 0 : cosSigma - 2 * Math.sin(u1) * Math.sin(u2) / cosSquaredAlpha;
    const c = flattening / 16 * cosSquaredAlpha * (4 + flattening * (4 - 3 * cosSquaredAlpha));
    const previous = lambda;
    lambda = longitude + (1 - c) * flattening * sinAlpha * (sigma + c * sinSigma * (cos2SigmaM + c * cosSigma * (-1 + 2 * cos2SigmaM ** 2)));
    if (Math.abs(lambda - previous) < 1e-14) { converged = true; break; }
  }
  assert.ok(converged, "The short WGS84 transect must converge");
  const uSquared = cosSquaredAlpha * (semiMajor ** 2 - semiMinor ** 2) / semiMinor ** 2;
  const coefficientA = 1 + uSquared / 16384 * (4096 + uSquared * (-768 + uSquared * (320 - 175 * uSquared)));
  const coefficientB = uSquared / 1024 * (256 + uSquared * (-128 + uSquared * (74 - 47 * uSquared)));
  const deltaSigma = coefficientB * sinSigma * (cos2SigmaM + coefficientB / 4 * (cosSigma * (-1 + 2 * cos2SigmaM ** 2) - coefficientB / 6 * cos2SigmaM * (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cos2SigmaM ** 2)));
  return semiMinor * coefficientA * (sigma - deltaSigma);
}

test("imported TIFF bytes retain all three independently recorded source hashes", async () => {
  const data = await loaded;
  data.forEach(({ bytes }, i) => assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedHashes[i]));
});

test("real TIFF headers and decoded bands have the common Float32 Web Mercator grid", async () => {
  const data = await loaded;
  data.forEach(({ raster }, i) => {
    assert.equal(raster.width, 854);
    assert.equal(raster.height, 998);
    assert.equal(raster.crs, "EPSG:3857");
    assert.equal(raster.dataType, "float32");
    assert.equal(raster.bandCount, i === 2 ? 1 : 2);
    assert.deepEqual(raster.pixelSizeMeters, [30, 30]);
    assert.deepEqual(raster.transform, [30, 0, 13461866.021630574, 0, -30, 1661556.429169403]);
    assert.ok(Number.isNaN(raster.noData));
    for (const band of raster.bands) {
      assert.equal(band.length, 852292);
      assert.ok(band.every(Number.isFinite));
    }
  });
  assert.doesNotThrow(() => assertAlignedGrids(...data.map((d) => d.raster) as [DecodedRaster, ...DecodedRaster[]]));
});

test("WGS84 sampling matches independently sampled rasterio Tumana fixtures without a second logarithm", async () => {
  const [{ raster: baseline }, { raster: post }, { raster: dem }] = await loaded;
  const lon = 121.09593983925672, lat = 14.6580158;
  assert.deepEqual(pixelAtWgs84(baseline, lon, lat), { column: 615, row: 391 });
  assert.equal(sampleRasterWgs84(baseline, lon, lat), -9.413383483886719);
  assert.equal(sampleRasterWgs84(baseline, lon, lat, 1), -16.920053482055664);
  assert.equal(sampleRasterWgs84(post, lon, lat), -7.053439140319824);
  assert.equal(sampleRasterWgs84(dem, lon, lat), 10.264633178710938);
  const change = backscatterChangeDb(sampleRasterWgs84(baseline, lon, lat), sampleRasterWgs84(post, lon, lat));
  assert.ok(change !== null && Math.abs(change - 2.3599443435668945) < 1e-10);
});

test("all 59 archived profile values match actual TIFF sampling within original serialization precision", async () => {
  const [{ raster: baseline }, { raster: post }, { raster: dem }] = await loaded;
  const reference = JSON.parse(await readFile(new URL("../data/transect/reference.json", import.meta.url), "utf8"));
  assert.equal(reference.sample_count, 59);
  assert.equal(reference.samples.length, 59);
  assert.equal(reference.distance_m, 1723.56707152871);
  for (const sample of reference.samples) {
    for (const [raster, band, expected] of [[dem, 0, sample.dsm_m], [baseline, 0, sample.vv_base], [post, 0, sample.vv_post], [baseline, 1, sample.vh_base], [post, 1, sample.vh_post]] as const) {
      const actual = sampleRasterWgs84(raster, sample.lon, sample.lat, band);
      assert.ok(actual !== null && Math.abs(actual - expected) <= .000501);
    }
    const delta = backscatterChangeDb(sampleRasterWgs84(baseline, sample.lon, sample.lat), sampleRasterWgs84(post, sample.lon, sample.lat));
    assert.ok(delta !== null && Math.abs(delta - sample.delta_vv) <= .000505);
    // Each of the three archived dB fields was rounded independently to .001.
    assert.ok(Math.abs(sample.vv_post - sample.vv_base - sample.delta_vv) <= .001501);
  }
});

test("transect endpoints, cumulative order and total are independently geodesically consistent", async () => {
  const reference = JSON.parse(await readFile(new URL("../data/transect/reference.json", import.meta.url), "utf8"));
  const first = reference.samples[0], last = reference.samples.at(-1);
  assert.deepEqual([first.lon, first.lat], reference.start);
  assert.deepEqual([last.lon, last.lat], reference.end);
  const total = geodesicMeters(reference.start, reference.end);
  assert.ok(Math.abs(total - reference.distance_m) < .00001);
  let cumulative = 0;
  reference.samples.forEach((sample: { lon: number; lat: number; distance_m: number }, index: number) => {
    const coordinate = [sample.lon, sample.lat];
    if (index > 0) {
      const previous = reference.samples[index - 1];
      assert.ok(sample.distance_m > previous.distance_m);
      const segment = geodesicMeters([previous.lon, previous.lat], coordinate);
      assert.ok(Math.abs(segment - total / 58) < .00001);
      cumulative += segment;
    }
    // Saved cumulative distances are rounded to centimetres, not centimetre accuracy.
    assert.ok(Math.abs(cumulative - sample.distance_m) <= .00501);
    assert.ok(Math.abs(geodesicMeters(reference.start, coordinate) - sample.distance_m) <= .00501);
  });
  assert.ok(Math.abs(cumulative - total) < .00001);
});

test("sampling leaves missing data and outside-grid positions unknown", async () => {
  const { raster } = (await loaded)[2];
  assert.equal(sampleRasterWgs84(raster, 0, 0), null);
  assert.equal(sampleRasterWgs84(raster, NaN, 14.65), null);
  assert.equal(sampleRasterWgs84(raster, 121, 90), null);
  assert.equal(sampleRasterPixel(raster, -1, 0), null);
  assert.equal(sampleRasterPixel(raster, 854, 0), null);
  assert.equal(sampleRasterPixel(raster, 0, 998), null);
  assert.throws(() => sampleRasterPixel(raster, 0, 0, 1), RangeError);
  const fixture: DecodedRaster = { ...raster, width: 3, height: 1, noData: -9999, bands: [new Float32Array([NaN, -9999, Infinity])] };
  for (let col = 0; col < 3; col++) assert.equal(sampleRasterPixel(fixture, col, 0), null);
  assert.equal(backscatterChangeDb(null, -7), null);
  assert.equal(backscatterChangeDb(-9, NaN), null);
});

test("a shifted grid or different projection cannot masquerade as aligned observations", async () => {
  const { raster } = (await loaded)[0];
  assert.throws(() => assertAlignedGrids(raster, { ...raster, width: 853 }), /not aligned/);
  assert.throws(() => assertAlignedGrids(raster, { ...raster, crs: "EPSG:32651" }), /not aligned/);
  assert.throws(() => assertAlignedGrids(raster, { ...raster, transform: [30, 0, raster.transform[2] + 15, 0, -30, raster.transform[5]] }), /not aligned/);
  assert.throws(() => assertAlignedGrids({ ...raster, transform: [30, 0, NaN, 0, -30, raster.transform[5]] }), /Invalid/);
  assert.throws(() => pixelAtWgs84({ ...raster, crs: "EPSG:32651" }, 121, 14.6), /EPSG:3857/);
  await assert.rejects(() => decodeRaster(new Uint8Array([0, 1, 2, 3])), /./);
});

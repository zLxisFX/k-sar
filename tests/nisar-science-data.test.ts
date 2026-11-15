import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decodeRaster, pixelAtWgs84, sampleRasterWgs84, assertAlignedGrids } from "../src/domain/raster.ts";
import { sampleScience, validateSciencePair } from "../src/domain/nisar-science.ts";

const data = new URL("../data/", import.meta.url);
const loaded = Promise.all(["nasa/nisar/science/2026-10-21-db.tif", "nasa/nisar/science/2026-11-02-db.tif", "nasa/nisar/science/change-db.tif", "sentinel-1/baseline.tif", "sentinel-1/post.tif", "sentinel-1/dem.tif"].map(async path => decodeRaster(await readFile(new URL(path, data)))));

test("actual GeoTIFF decoding preserves calibrated pair grid, missing pixels and change arrays", async () => {
  const [before, after, change, sentinel, , dsm] = await loaded;
  validateSciencePair({ before, after, change });
  assertAlignedGrids(before, sentinel, dsm);
  assert.deepEqual([before.width, before.height, before.dataType, before.crs], [854, 998, "float32", "EPSG:3857"]);
  assert.ok(Number.isNaN(before.noData));
  for (let band = 0; band < 2; band++) {
    let count = 0;
    for (let index = 0; index < before.bands[band].length; index++) {
      const a = before.bands[band][index], b = after.bands[band][index], delta = change.bands[band][index];
      if (Number.isFinite(a) && Number.isFinite(b)) {
        assert.equal(delta, Math.fround(b - a));
        count++;
      } else assert.ok(Number.isNaN(delta));
    }
    assert.equal(count, 852283);
  }
});

test("all 59 calibrated browser samples match independent rasterio fixtures across both sensors", async () => {
  const [before, after, change, sentinelBefore, sentinelAfter, dsm] = await loaded;
  const transect = JSON.parse(await readFile(new URL("nasa/nisar/science/transect.json", data), "utf8"));
  assert.equal(transect.samples.length, 59);
  for (const row of [...transect.samples, ...transect.selectedLocations]) {
    assert.deepEqual(pixelAtWgs84(before, row.lon, row.lat), { column: row.column, row: row.row });
    const actual = sampleScience({ before, after, change }, row.lon, row.lat);
    for (const [band, pol] of ["HH", "HV"].entries()) {
      assert.equal(actual[pol as "HH" | "HV"].before, row.nisar.before[pol]);
      assert.equal(actual[pol as "HH" | "HV"].after, row.nisar.after[pol]);
      const delta = actual[pol as "HH" | "HV"].delta;
      assert.equal(delta === null ? null : Math.fround(delta), row.nisar.change[pol]);
      assert.equal(sampleRasterWgs84(change, row.lon, row.lat, band), row.nisar.change[pol]);
    }
    for (const [band, pol] of ["VV", "VH"].entries()) {
      assert.equal(sampleRasterWgs84(sentinelBefore, row.lon, row.lat, band), row.sentinel1.before[pol]);
      assert.equal(sampleRasterWgs84(sentinelAfter, row.lon, row.lat, band), row.sentinel1.after[pol]);
    }
    assert.equal(sampleRasterWgs84(dsm, row.lon, row.lat), row.dsmM);
  }
});

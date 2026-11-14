import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { correctedElevation, scenarioDepth, isScenarioClosed } from "../src/domain/elevation.ts";

test("subsidence-only equation lowers every real profile sample by 0.390m", async () => {
  const reference = JSON.parse(await readFile(new URL("../data/transect/reference.json", import.meta.url), "utf8"));
  for (const { dsm_m: z } of reference.samples) {
    const lower = correctedElevation(z, -30, 13);
    assert.ok(lower !== null && Math.abs((z - lower) - .390) < 1e-12);
    assert.equal(lower, correctedElevation(z, 30, 13));
    assert.equal(correctedElevation(z, -30, 0), z);
    assert.equal(correctedElevation(z, 0, 13), z);
  }
});

test("unknown DSM samples never become zero depth or a certified open edge", () => {
  for (const missing of [null, NaN, Infinity, -Infinity]) {
    assert.equal(correctedElevation(missing, -30, 13), null);
    assert.equal(scenarioDepth(10, missing), null);
    assert.equal(isScenarioClosed(missing), null);
  }
});

test("water above a surface gives positive depth and the closure boundary is strictly greater", () => {
  assert.equal(scenarioDepth(8, 10), 0);
  assert.equal(scenarioDepth(10, 10), 0);
  assert.equal(scenarioDepth(10, 9), 1);
  assert.equal(isScenarioClosed(0.30), false);
  assert.equal(isScenarioClosed(0.300001), true);
  assert.equal(isScenarioClosed(0.299999), false);
  assert.equal(isScenarioClosed(0, 0), false);
  assert.equal(isScenarioClosed(.01, 0), true);
});

test("lowering and higher water are monotone under the stated uniform scenario", () => {
  const oldSurface = 10;
  const lowered = correctedElevation(oldSurface, -30, 13);
  const before = scenarioDepth(10, oldSurface), after = scenarioDepth(10, lowered);
  assert.ok(before !== null && after !== null && after > before);
  assert.ok(Math.abs(after - .390) < 1e-12);
  assert.equal(isScenarioClosed(before), false);
  assert.equal(isScenarioClosed(after), true);
});

test("nonfinite or impossible scenario parameters fail explicitly", () => {
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.throws(() => correctedElevation(10, invalid, 13), RangeError);
    assert.throws(() => correctedElevation(10, -30, invalid), RangeError);
    assert.throws(() => scenarioDepth(invalid, 10), RangeError);
    assert.throws(() => isScenarioClosed(1, invalid), RangeError);
  }
  assert.throws(() => correctedElevation(10, -30, -1), RangeError);
  assert.throws(() => isScenarioClosed(-1), RangeError);
  assert.throws(() => isScenarioClosed(1, -1), RangeError);
});

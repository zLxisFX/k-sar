import test from "node:test";
import assert from "node:assert/strict";
import { serializeSession } from "../src/domain/session.ts";
import type { SessionState } from "../src/domain/session.ts";

const timestamp = "2026-11-14T07:20:00.000Z";
const state: SessionState = {
  datasets: [{ id: "test-fixture", sha256: "a".repeat(64) }],
  view: { center: [121.09, 14.65], zoom: 13, curtainPercent: 50, selectedCoordinate: null, transectIndex: 29, layers: { radar: true, roadNetwork: true, crossSection: true } },
  surfacePreview: { waterLevelM: 10, rateMmYear: -30, elapsedYears: 13 },
  requestedRoute: null, appliedRoute: null, calculationPending: false,
};

test("session JSON is deterministic, lossless and explicitly distinguishes the client clock", () => {
  const first = serializeSession(state, timestamp);
  assert.equal(first, serializeSession(structuredClone(state), timestamp));
  const restored = JSON.parse(first);
  assert.equal(restored.schemaVersion, 2);
  assert.equal(restored.clockVerified, false);
  assert.equal(restored.recordedAtClient, timestamp);
  assert.deepEqual(restored.view, state.view);
  assert.deepEqual(restored.datasets, state.datasets);
  assert.deepEqual(restored.surfacePreview, state.surfacePreview);
});

test("pending state is preserved without inventing an applied route", () => {
  const restored = JSON.parse(serializeSession({ ...state, calculationPending: true }, timestamp));
  assert.equal(restored.calculationPending, true);
  assert.equal(restored.appliedRoute, null);
});

test("disabled scenario routing retains a non-default visible surface preview independently", () => {
  const preview = { waterLevelM: 12.5, rateMmYear: -42, elapsedYears: 22 };
  const requestedRoute = { origin: [121.09593983925672, 14.6580158] as const, hospitalId: "way/54025002", scenario: null };
  const restored = JSON.parse(serializeSession({ ...state, surfacePreview: preview, requestedRoute }, timestamp));
  assert.deepEqual(restored.surfacePreview, preview);
  assert.deepEqual(restored.requestedRoute, requestedRoute);
  assert.equal(restored.requestedRoute.scenario, null);
  assert.equal(restored.appliedRoute, null);
  assert.equal(restored.calculationPending, false);
});

test("all independent map-layer and profile visibility combinations survive export", () => {
  for (let flags = 0; flags < 8; flags++) {
    const layers = { radar: Boolean(flags & 1), roadNetwork: Boolean(flags & 2), crossSection: Boolean(flags & 4) };
    const restored = JSON.parse(serializeSession({ ...state, view: { ...state.view, layers } }, timestamp));
    assert.deepEqual(restored.view.layers, layers);
    assert.deepEqual(restored.surfacePreview, state.surfacePreview);
  }
});

test("missing or malformed preview and layer settings cannot produce an incomplete session", () => {
  for (const key of ["radar", "roadNetwork", "crossSection"] as const) {
    for (const invalid of ["false", 0, 1, null, undefined]) {
      const layers = { ...state.view.layers, [key]: invalid } as unknown as SessionState["view"]["layers"];
      assert.throws(() => serializeSession({ ...state, view: { ...state.view, layers } }, timestamp));
    }
  }
  const missingLayers = structuredClone(state);
  Reflect.deleteProperty(missingLayers.view, "layers");
  assert.throws(() => serializeSession(missingLayers, timestamp), /visibility/);
  const missingPreview = structuredClone(state);
  Reflect.deleteProperty(missingPreview, "surfacePreview");
  assert.throws(() => serializeSession(missingPreview, timestamp), /preview/);
  for (const surfacePreview of [
    { waterLevelM: NaN, rateMmYear: -30, elapsedYears: 13 },
    { waterLevelM: 10, rateMmYear: 30, elapsedYears: 13 },
    { waterLevelM: 10, rateMmYear: -30, elapsedYears: -1 },
  ]) assert.throws(() => serializeSession({ ...state, surfacePreview }, timestamp));
});

test("nonfinite values, unsupported JSON and invalid view coordinates cannot be silently exported", () => {
  for (const zoom of [NaN, Infinity, -1, 25]) assert.throws(() => serializeSession({ ...state, view: { ...state.view, zoom } }, timestamp));
  assert.throws(() => serializeSession({ ...state, view: { ...state.view, center: [181, 14] } }, timestamp));
  assert.throws(() => serializeSession({ ...state, view: { ...state.view, transectIndex: 59 } }, timestamp));
  assert.throws(() => serializeSession({ ...state, datasets: [] }, timestamp));
  assert.throws(() => serializeSession({ ...state, datasets: [{ id: "graph", sha256: "unverified" }] }, timestamp));
  assert.throws(() => serializeSession(state, "not-a-date"));
  const invalid = structuredClone(state) as unknown as Record<string, unknown>;
  invalid.circular = invalid;
  assert.throws(() => serializeSession(invalid as unknown as SessionState, timestamp), /circular/);
});

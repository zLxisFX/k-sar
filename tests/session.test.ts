import test from "node:test";
import assert from "node:assert/strict";
import { serializeSession } from "../src/domain/session.ts";
import type { SessionState } from "../src/domain/session.ts";

const timestamp = "2026-11-14T07:20:00.000Z";
const state: SessionState = {
  datasets: [{ id: "test-fixture", sha256: "a".repeat(64) }],
  view: { center: [121.09, 14.65], zoom: 13, curtainPercent: 50, selectedCoordinate: null, transectIndex: 29 },
  requestedRoute: null, appliedRoute: null, calculationPending: false,
};

test("session JSON is deterministic, lossless and explicitly distinguishes the client clock", () => {
  const first = serializeSession(state, timestamp);
  assert.equal(first, serializeSession(structuredClone(state), timestamp));
  const restored = JSON.parse(first);
  assert.equal(restored.schemaVersion, 1);
  assert.equal(restored.clockVerified, false);
  assert.equal(restored.recordedAtClient, timestamp);
  assert.deepEqual(restored.view, state.view);
  assert.deepEqual(restored.datasets, state.datasets);
});

test("pending state is preserved without inventing an applied route", () => {
  const restored = JSON.parse(serializeSession({ ...state, calculationPending: true }, timestamp));
  assert.equal(restored.calculationPending, true);
  assert.equal(restored.appliedRoute, null);
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

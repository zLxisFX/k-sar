import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildRoadGraph, nearestRoadNode } from "../src/domain/graph.ts";
import { prepareScenario, searchGraph } from "../src/domain/routing.ts";
import { loadRoutingData, getRoutingCatalog } from "../src/server/routing-loader.ts";
import { findConnectivityThreshold } from "../scripts/analyze-routing-threshold.ts";

test("threshold analysis finds the directed separating cut across alternative paths and excludes unknown samples", () => {
  const graph = buildRoadGraph({
    schemaVersion: 1,
    nodes: [[100, 121, 14, 0, 0], [200, 121.001, 14, 100, 0], [300, 121.002, 14, 200, 0], [400, 121.001, 14.001, 100, 100]],
    edges: [[0, 1, 0, 1, 3, 0, 0, "Short low path"], [1, 2, 0, 1, 20, 0, 0, "High end"],
      [0, 3, 0, 20, 10, 0, 0, "Long high path"], [3, 2, 0, 20, 10, 0, 0, "High end"],
      [0, 2, 0, 1, 30, 1, 0, "Unknown direct path"], [0, 2, 1, 30, 10, 0, 0, "Parallel alternative"]],
    geometries: [[[121, 14], [121.001, 14]]],
  });
  const result = findConnectivityThreshold(graph, 0, 2);
  assert.equal(result?.minimumDsmM, 10, "Connectivity threshold must not be the shortest path's lower bottleneck or an unknown edge's higher value.");
  assert.deepEqual(result?.criticalEdgeIds, [2, 5], "The cut includes both competing directed paths.");
  assert.equal(findConnectivityThreshold(graph, 2, 0), null, "Reverse connectivity must not be invented.");
  assert.throws(() => findConnectivityThreshold(graph, 0, 0), /distinct/);
});

test("real graph has the recorded exact threshold and a strict open/closed boundary at adjacent water values", async () => {
  const artifact = JSON.parse(await readFile("data/network/routing-threshold.json", "utf8"));
  const { graph, graphHash } = await loadRoutingData(), catalog = await getRoutingCatalog();
  const origin = catalog.origins.find((entry) => entry.id === "tumana")!;
  const destination = catalog.hospitals.find((entry) => entry.id === "way/54025002")!;
  const source = nearestRoadNode(graph, origin.coordinate).index, target = nearestRoadNode(graph, destination.coordinate).index;
  const threshold = findConnectivityThreshold(graph, source, target);
  assert.equal(artifact.graphSha256, graphHash);
  assert.equal(threshold?.minimumDsmM, 11.612146377563477);
  assert.deepEqual(threshold?.criticalEdgeIds, [84300]);
  assert.deepEqual(threshold?.criticalEdgeIds, artifact.threshold.criticalEdgeIds);
  for (const boundary of [artifact.threshold.unchanged, artifact.threshold.lowered]) {
    assert.equal(boundary.lastConnected.cutoffSurfaceM, threshold!.minimumDsmM);
    assert.ok(boundary.firstDisconnected.cutoffSurfaceM > threshold!.minimumDsmM);
    const encoded = new DataView(new ArrayBuffer(16));
    encoded.setFloat64(0, boundary.lastConnected.waterLevelM); encoded.setFloat64(8, boundary.firstDisconnected.waterLevelM);
    assert.equal(encoded.getBigUint64(8) - encoded.getBigUint64(0), 1n, "Positive water values must be adjacent representable doubles.");
    for (const record of [boundary.lastConnected, boundary.firstDisconnected]) {
      const state = prepareScenario(graph, record, false);
      const result = searchGraph(graph, source, target, state.excluded);
      assert.equal(result.edgeIds === null ? "NO_PATH" : "NETWORK_PATH", record.status);
      assert.equal(result.lengthM, record.lengthM);
    }
  }
  const unchanged = prepareScenario(graph, { waterLevelM: 11.6, rateMmYear: 0, elapsedYears: 13 }, false);
  const lowered = prepareScenario(graph, { waterLevelM: 11.6, rateMmYear: -30, elapsedYears: 13 }, false);
  assert.equal(searchGraph(graph, source, target, unchanged.excluded).lengthM, 27875.63395980343);
  assert.equal(searchGraph(graph, source, target, lowered.excluded).edgeIds, null);
  assert.equal(unchanged.closedEdges, 61848); assert.equal(lowered.closedEdges, 63408);
  assert.equal(lowered.closedEdges - unchanged.closedEdges, 1560);
  assert.equal(unchanged.unknownEdges, 6); assert.equal(lowered.unknownEdges, 6);
  assert.ok(graph.edges.every((_, id) => !unchanged.excluded[id] || lowered.excluded[id]), "Uniform lowering cannot reopen any excluded edge.");
});

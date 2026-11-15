import test from "node:test";
import assert from "node:assert/strict";
import { buildRoadGraph, nearestRoadNode } from "../src/domain/graph.ts";
import type { RoadGraphData } from "../src/domain/graph.ts";
import { prepareScenario, summarizeScenario, searchGraph, solveRoute } from "../src/domain/routing.ts";
import { loadRoutingData, parseRouteRequest, computeRoute, getRoutingCatalog } from "../src/server/routing-loader.ts";
import { GET, POST } from "../src/app/api/route/route.ts";

function fixture(): RoadGraphData {
  return {
    schemaVersion: 1,
    nodes: [[100, 121, 14, 0, 0], [200, 121.001, 14, 100, 0], [300, 121.002, 14, 200, 0], [400, 121.001, 14.001, 100, 100]],
    edges: [[0, 1, 0, 9, 9.7, 0, 0, "A"], [0, 1, 1, 2, 9.699, 0, 0, "Parallel"], [1, 2, 0, 2, 12, 0, 1, "B"], [0, 3, 0, 3, 20, 0, 2, "C"], [3, 2, 0, 3, 20, 0, 3, "D"]],
    geometries: [[[121, 14], [121.001, 14]], [[121.001, 14], [121.002, 14]], [[121, 14], [121.001, 14.001]], [[121.001, 14.001], [121.002, 14]]],
  };
}

// Independent O(V²) Dijkstra oracle, using no heap or heuristic from production.
function oracle(data: RoadGraphData, source: number, target: number, blocked: Set<number>): number | null {
  const costs = Array(data.nodes.length).fill(Infinity), remaining = new Set(data.nodes.map((_, i) => i));
  costs[source] = 0;
  while (remaining.size) {
    const node = [...remaining].reduce((a, b) => costs[a] < costs[b] ? a : b);
    if (!Number.isFinite(costs[node])) break;
    if (node === target) return costs[node];
    remaining.delete(node);
    data.edges.forEach((edge, i) => { if (edge[0] === node && !blocked.has(i)) costs[edge[1]] = Math.min(costs[edge[1]], costs[node] + edge[3]); });
  }
  return null;
}

test("A* matches an independent shortest-path oracle across directed parallel-edge exclusions", () => {
  const data = fixture(), graph = buildRoadGraph(data);
  assert.ok(graph.heuristicScale < .03, "Short edge lengths must reduce the geometric heuristic");
  for (let mask = 0; mask < 2 ** data.edges.length; mask++) {
    const excluded = Uint8Array.from(data.edges.map((_, i) => (mask >> i) & 1));
    const blocked = new Set(data.edges.map((_, i) => i).filter((i) => excluded[i]));
    for (let start = 0; start < data.nodes.length; start++) for (let end = 0; end < data.nodes.length; end++) {
      const actual = searchGraph(graph, start, end, excluded);
      assert.equal(actual.lengthM, oracle(data, start, end, blocked));
      if (actual.edgeIds) assert.ok(actual.edgeIds.every((id) => !blocked.has(id)));
    }
  }
  assert.deepEqual(searchGraph(graph, 0, 0).edgeIds, []);
  assert.equal(searchGraph(graph, 2, 0).edgeIds, null, "One-way roads must remain directed");
});

test("modeled closure is strictly above 0.30m, with unknown and lowering handled separately", () => {
  const data = fixture();
  data.edges.push([1, 3, 0, 2, 40, 1, 0, "Partial unknown"], [3, 1, 0, 2, null, 2, 0, "Missing"]);
  const graph = buildRoadGraph(data), state = prepareScenario(graph, { waterLevelM: 10, rateMmYear: 0, elapsedYears: 13 });
  assert.equal(state.excluded[0], 0, "10m water minus9.7m DSM equals the cutoff, not above it");
  assert.equal(state.excluded[1], 1);
  assert.equal(state.closedEdges, 1);
  assert.equal(state.unknownEdges, 2);
  assert.equal(state.excludedEdges, 3);
  const lowered = prepareScenario(graph, { waterLevelM: 10, rateMmYear: -30, elapsedYears: 13 });
  assert.equal(lowered.verticalLoweringM, .39);
  assert.equal(lowered.excluded[0], 1);
  assert.ok(lowered.closedEdges >= state.closedEdges);
  assert.throws(() => prepareScenario(graph, { waterLevelM: 10, rateMmYear: 30, elapsedYears: 13 }), RangeError);
});

test("invalid graph and request values fail explicitly", () => {
  let data = fixture(); data.nodes[1] = data.nodes[0]; assert.throws(() => buildRoadGraph(data), /Duplicate/);
  data = fixture(); data.geometries[0] = [[181, 14], [121, 14]]; assert.throws(() => buildRoadGraph(data), /geometry/);
  data = fixture(); data.edges[0] = [0, 1, 0, -1, 10, 0, 0, "Invalid"]; assert.throws(() => buildRoadGraph(data), /edge/);
  for (const origin of [null, [NaN, 14], [121, 91], ["121", 14], [121]]) assert.throws(() => parseRouteRequest({ origin, hospitalId: "way/54025002", scenario: null }), RangeError);
  assert.throws(() => parseRouteRequest({ origin: [121, 14], hospitalId: "way/54025002", scenario: { waterLevelM: Infinity, rateMmYear: -30, elapsedYears: 13 } }), RangeError);
});

test("added closures compare directed edges before deduplicating shared geometry and omit unknown coverage", () => {
  const data = fixture();
  data.edges[3] = [0, 3, 0, 3, 9.9, 0, 2, "New geometry"];
  data.edges.push([1, 0, 0, 9, 9.7, 0, 0, "New reverse direction"], [3, 1, 0, 2, 9, 1, 3, "Unknown"]);
  const graph = buildRoadGraph(data);
  const summary = summarizeScenario(graph, prepareScenario(graph, { waterLevelM: 10, rateMmYear: -30, elapsedYears: 13 }));
  assert.equal(summary.closedEdgesWithoutLowering, 1);
  assert.equal(summary.additionalClosedEdges, 3);
  assert.equal(summary.closedEdges, 4);
  assert.equal(summary.unknownEdges, 1);
  assert.deepEqual(summary.additionalClosures.features[0].geometry.coordinates, [graph.geometries[0], graph.geometries[2]], "The already-closed parallel direction must not hide a newly closed direction, and reciprocal directions share one displayed shape");
  assert.deepEqual(summary.unknownClosures.features[0].geometry.coordinates, [graph.geometries[3]]);
});

test("full imported graph preserves counts and reproduces selected-anchor routes with conservative unknown coverage", async () => {
  const { graph, hospitals } = await loadRoutingData();
  assert.equal(graph.nodes.length, 62446); assert.equal(graph.edges.length, 155830); assert.equal(hospitals.length, 215);
  assert.equal(graph.edges.filter((edge) => edge[5] > 0).length, 6);
  const hospital = hospitals.find((h) => h.id === "way/54025002")!;
  const origins = [[121.09379427092635, 14.64796565], [121.09593983925672, 14.6580158]] as const;
  const expected = [2163.6244309361223, 3726.297134241261];
  origins.forEach((origin, i) => {
    const route = solveRoute(graph, origin, hospital.coordinate);
    assert.equal(route.status, "NETWORK_PATH");
    assert.ok(Math.abs(route.lengthM! - expected[i]) < 1e-7);
    assert.ok(route.solveMs >= 0);
    const first = graph.nodes[nearestRoadNode(graph, origin).index];
    assert.deepEqual(route.feature?.geometry.coordinates[0], [first[1], first[2]]);
  });
  const staticState = prepareScenario(graph, { waterLevelM: 10, rateMmYear: 0, elapsedYears: 13 }, false);
  assert.equal(staticState.closedEdges, 55136); assert.equal(staticState.unknownEdges, 6); assert.equal(staticState.excludedEdges, 55142);
  const state = prepareScenario(graph, { waterLevelM: 10, rateMmYear: -30, elapsedYears: 13 }, false);
  assert.equal(state.closedEdges, 56568); assert.equal(state.unknownEdges, 6); assert.equal(state.excludedEdges, 56574);
  const route = solveRoute(graph, origins[1], hospital.coordinate, state);
  assert.equal(route.status, "NETWORK_PATH"); assert.ok(Math.abs(route.lengthM! - 27875.63395980343) < 1e-7);
  assert.ok(route.edgeIds.every((id) => !state.excluded[id]));
  const deeper = prepareScenario(graph, { waterLevelM: 12, rateMmYear: -30, elapsedYears: 13 }, false);
  const noPath = solveRoute(graph, origins[1], hospital.coordinate, deeper);
  assert.equal(noPath.status, "NO_PATH"); assert.equal(noPath.feature, null); assert.equal(noPath.lengthM, null);
  assert.equal(solveRoute(graph, [0, 0], hospital.coordinate).status, "NO_NEARBY_ROAD");
});

test("route response preserves applied inputs, graph hashes and selected destination scope", async () => {
  const request = { origin: [121.09593983925672, 14.6580158] as const, hospitalId: "way/54025002", scenario: { waterLevelM: 10, rateMmYear: -30, elapsedYears: 13 } };
  const response = await computeRoute(request);
  assert.deepEqual(response.request, request);
  assert.equal(response.graph.sourceGraphSha256, "4c4a8eb4138c1d8f452e92422a5f43860bdd1ee0f19763f0ac406f0dfaf3e7e4");
  assert.match(response.graph.sha256, /^[a-f0-9]{64}$/);
  assert.equal(response.destination.id, request.hospitalId);
  assert.equal(response.scenarioSummary?.unknownEdges, 6);
  assert.equal(response.scenarioSummary?.closedEdgesWithoutLowering, 55136);
  assert.equal(response.scenarioSummary?.additionalClosedEdges, 1432);
  assert.equal(response.scenarioSummary?.closedEdges, 56568);
  assert.ok(response.scenarioSummary?.closures.features[0].geometry.coordinates.length);
  const { graph } = await loadRoutingData();
  const addedEdges = graph.edges.filter((edge) => edge[4] !== null && edge[5] === 0 && edge[4] >= 10 - .30 && edge[4] < 10 + .390 - .30);
  assert.equal(addedEdges.length, 1432);
  const addedShapes = [...new Set(addedEdges.map((edge) => edge[6]))];
  assert.deepEqual(response.scenarioSummary?.additionalClosures.features.flatMap((feature) => feature.geometry.coordinates), addedShapes.map((id) => graph.geometries[id]));
  assert.ok(!("excluded" in response.scenarioSummary!), "Internal mask is not serialized");
  assert.match(response.limitations, /does not establish isolation from all hospitals/);
  await assert.rejects(() => computeRoute({ ...request, hospitalId: "way/99999999999" }), RangeError);
});

test("no lowering adds zero known closures while retaining the same water-level reference and unknown count", async () => {
  for (const [rateMmYear, elapsedYears] of [[0, 13], [-30, 0]]) {
    const response = await computeRoute({ origin: [121.09593983925672, 14.6580158], hospitalId: "way/54025002", scenario: { waterLevelM: 10, rateMmYear, elapsedYears } });
    assert.equal(response.scenarioSummary?.closedEdgesWithoutLowering, 55136);
    assert.equal(response.scenarioSummary?.closedEdges, 55136);
    assert.equal(response.scenarioSummary?.additionalClosedEdges, 0);
    assert.deepEqual(response.scenarioSummary?.additionalClosures, { type: "FeatureCollection", features: [] });
    assert.equal(response.scenarioSummary?.unknownEdges, 6);
    assert.equal(response.scenarioSummary?.excludedEdges, 55142);
    assert.strictEqual(response.withoutLoweringRoute, response.scenarioRoute, "A zero-lowering scenario reuses the identical solve, including its timing.");
  }
});

test("same-water counterfactual route separates lowering from topology and changing water level", async () => {
  const request = { origin: [121.09593983925672, 14.6580158] as const, hospitalId: "way/54025002" };
  const topology = await computeRoute({ ...request, scenario: null });
  assert.equal(topology.withoutLoweringRoute, null);
  for (const [waterLevelM, knownWithout, knownWith] of [[10, 55136, 56568], [11.6, 61848, 63408]]) {
    const response = await computeRoute({ ...request, scenario: { waterLevelM, rateMmYear: -30, elapsedYears: 13 } });
    const reference = response.withoutLoweringRoute!;
    assert.equal(reference.status, "NETWORK_PATH");
    assert.equal(reference.lengthM, 27875.63395980343);
    assert.notEqual(reference.lengthM, response.baseline.lengthM, "The reference retains water screening instead of substituting the topology-only path.");
    assert.equal(reference.excludedEdges, knownWithout + 6);
    assert.equal(response.scenarioRoute!.excludedEdges, knownWith + 6);
    assert.equal(reference.sourceNode, response.scenarioRoute!.sourceNode);
    assert.equal(reference.targetNode, response.scenarioRoute!.targetNode);
    assert.ok(reference.feature && reference.edgeIds.length > 0);
    if (waterLevelM === 10) {
      assert.deepEqual(reference.edgeIds, response.scenarioRoute!.edgeIds);
      assert.equal(reference.lengthM, response.scenarioRoute!.lengthM);
    } else {
      assert.equal(response.scenarioRoute!.status, "NO_PATH");
      assert.equal(response.scenarioRoute!.feature, null);
    }
  }
});

test("HTTP handlers return real catalog data and reject malformed requests", async () => {
  const catalog = await getRoutingCatalog(); assert.equal(catalog.defaultHospitalId, "way/54025002");
  const response = await GET(); assert.equal(response.status, 200); assert.equal((await response.json()).counts.hospitalFeatures, 215);
  assert.equal((await POST(new Request("http://localhost/api/route", { method: "POST", body: "{" }))).status, 400);
  assert.equal((await POST(new Request("http://localhost/api/route", { method: "POST", body: " ".repeat(5000) }))).status, 413);
  const valid = await POST(new Request("http://localhost/api/route", { method: "POST", body: JSON.stringify({ origin: [121.09593983925672, 14.6580158], hospitalId: "way/54025002", scenario: null }) }));
  assert.equal(valid.status, 200); assert.equal((await valid.json()).baseline.status, "NETWORK_PATH");
});

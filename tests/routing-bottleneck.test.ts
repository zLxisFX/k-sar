import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tippingBottleneck } from "../src/domain/routing-bottleneck.ts";
import { computeRoute, loadRoutingData } from "../src/server/routing-loader.ts";
import { prepareScenario, searchGraph } from "../src/domain/routing.ts";
import { nearestRoadNode } from "../src/domain/graph.ts";

const request = {
  origin: [121.09593983925672, 14.6580158] as const,
  hospitalId: "way/54025002",
  scenario: { waterLevelM: 11.6, rateMmYear: 0, elapsedYears: 13 },
};

test("bottleneck overlay uses the proven graph edge and changes status for the exact paired comparison", async () => {
  const proof = JSON.parse(await readFile("data/network/routing-threshold.json", "utf8"));
  for (const rateMmYear of [0, -30]) {
    const response = await computeRoute({ ...request, scenario: { ...request.scenario, rateMmYear } });
    const overlay = tippingBottleneck(response)!;
    assert.ok(overlay);
    assert.equal(overlay.excluded, rateMmYear === -30);
    assert.deepEqual(overlay.edges.map((edge) => edge.id), proof.threshold.criticalEdgeIds);
    assert.deepEqual(overlay.edges[0].coordinates, proof.threshold.criticalEdges[0].coordinates);
    assert.equal(overlay.edges[0].name, "E. Rodriguez Highway");
    assert.ok(response.withoutLoweringRoute!.edgeIds.includes(overlay.edges[0].id));
  }
});

test("a stale or different graph, selected pair, scenario or routing result cannot inherit the cut label", async () => {
  const response = await computeRoute(request);
  assert.equal(tippingBottleneck(null), null);
  assert.equal(tippingBottleneck({ ...response, graph: { ...response.graph, sha256: "0".repeat(64) } }), null);
  for (const change of [
    { hospitalId: "node/54025002" },
    { origin: [121.09379427092635, 14.64796565] as const },
    { scenario: null },
    { scenario: { ...request.scenario, waterLevelM: 10 } },
    { scenario: { ...request.scenario, rateMmYear: -20 } },
    { scenario: { ...request.scenario, elapsedYears: 12 } },
  ]) assert.equal(tippingBottleneck({ ...response, request: { ...request, ...change } }), null);
  assert.equal(tippingBottleneck({ ...response, withoutLoweringRoute: null }), null);
  assert.equal(tippingBottleneck({ ...response, withoutLoweringRoute: { ...response.withoutLoweringRoute!, edgeIds: [] } }), null);
  assert.equal(tippingBottleneck({ ...response, scenarioRoute: { ...response.scenarioRoute!, status: "NO_PATH" } }), null);
});

test("excluding edge84300 alone disconnects the selected11.6m unlowered network", async () => {
  const { graph } = await loadRoutingData();
  const response = await computeRoute(request);
  const state = prepareScenario(graph, request.scenario, false);
  const edgeId = tippingBottleneck(response)!.edges[0].id;
  const sourceNode = nearestRoadNode(graph, request.origin).index;
  const targetNode = nearestRoadNode(graph, response.destination.coordinate).index;
  assert.equal(state.excluded[edgeId], 0);
  assert.equal(searchGraph(graph, sourceNode, targetNode, state.excluded).lengthM, 27875.63395980343);
  state.excluded[edgeId] = 1;
  assert.equal(searchGraph(graph, sourceNode, targetNode, state.excluded).edgeIds, null);
  state.excluded[edgeId] = 0;
  assert.equal(searchGraph(graph, sourceNode, targetNode, state.excluded).lengthM, 27875.63395980343);
});

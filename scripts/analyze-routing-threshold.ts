import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { RoadGraph } from "../src/domain/graph.ts";
import { nearestRoadNode } from "../src/domain/graph.ts";
import { prepareScenario, searchGraph, ROUTING_LIMITATIONS } from "../src/domain/routing.ts";
import { getRoutingCatalog, loadRoutingData } from "../src/server/routing-loader.ts";

// Connectivity is checked independently of A*: directed BFS, with unknown edges excluded.
function reachableNodes(graph: RoadGraph, source: number, cutoffM: number, excludeEqual = false): Uint8Array {
  const seen = new Uint8Array(graph.nodes.length), queue = new Int32Array(graph.nodes.length);
  let head = 0, tail = 1;
  queue[0] = source; seen[source] = 1;
  while (head < tail) {
    const node = queue[head++];
    for (const id of graph.adjacency[node]) {
      const edge = graph.edges[id], minimum = edge[4];
      if (seen[edge[1]] || minimum === null || edge[5] > 0
          || (excludeEqual ? minimum <= cutoffM : minimum < cutoffM)) continue;
      seen[edge[1]] = 1; queue[tail++] = edge[1];
    }
  }
  return seen;
}

export function findConnectivityThreshold(graph: RoadGraph, source: number, target: number) {
  if (source === target || ![source, target].every((id) => Number.isInteger(id) && id >= 0 && id < graph.nodes.length)) {
    throw new RangeError("Choose two distinct graph nodes.");
  }
  const levels = [...new Set(graph.edges.flatMap((edge) => edge[4] !== null && edge[5] === 0 ? [edge[4]] : []))].sort((a, b) => a - b);
  let low = 0, high = levels.length - 1, bottleneck: number | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (reachableNodes(graph, source, levels[middle])[target]) {
      bottleneck = levels[middle]; low = middle + 1;
    } else high = middle - 1;
  }
  if (bottleneck === null) return null;
  const disconnectedSide = reachableNodes(graph, source, bottleneck, true);
  assert.equal(disconnectedSide[target], 0, "Closing equality must disconnect the selected nodes.");
  const criticalEdgeIds = graph.edges.flatMap((edge, id) => edge[4] === bottleneck && edge[5] === 0
    && disconnectedSide[edge[0]] && !disconnectedSide[edge[1]] ? [id] : []);
  assert.ok(criticalEdgeIds.length);
  return { minimumDsmM: bottleneck, criticalEdgeIds, sourceComponentNodesAfterLoss: disconnectedSide.reduce((sum, value) => sum + value, 0) };
}

function adjacentFloat(value: number, direction: -1 | 1): number {
  if (value === 0) return direction * Number.MIN_VALUE;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const increment = (value > 0) === (direction > 0) ? 1n : -1n;
  view.setBigUint64(0, view.getBigUint64(0) + increment);
  return view.getFloat64(0);
}

function evaluate(graph: RoadGraph, source: number, target: number, waterLevelM: number, rateMmYear: number) {
  const parameters = { waterLevelM, rateMmYear, elapsedYears: 13 };
  const state = prepareScenario(graph, parameters, false);
  const result = searchGraph(graph, source, target, state.excluded);
  return {
    ...parameters, verticalLoweringM: state.verticalLoweringM || 0,
    cutoffSurfaceM: waterLevelM + state.verticalLoweringM - .30,
    status: result.edgeIds === null ? "NO_PATH" : "NETWORK_PATH",
    lengthM: result.lengthM, closedEdges: state.closedEdges,
    unknownEdges: state.unknownEdges, excludedEdges: state.excludedEdges,
  };
}

function exactWaterBoundary(graph: RoadGraph, source: number, target: number, minimumDsmM: number, rateMmYear: number) {
  const loweringM = Math.abs(rateMmYear) / 1000 * 13;
  const nominalWaterM = minimumDsmM + .30 - loweringM;
  let lastConnectedWaterM = nominalWaterM;
  const connected = (water: number) => water + loweringM - .30 <= minimumDsmM;
  let adjustments = 0;
  while (!connected(lastConnectedWaterM)) {
    if (++adjustments > 8) throw new Error("Unexpected floating-point boundary.");
    lastConnectedWaterM = adjacentFloat(lastConnectedWaterM, -1);
  }
  while (connected(adjacentFloat(lastConnectedWaterM, 1))) {
    if (++adjustments > 8) throw new Error("Unexpected floating-point boundary.");
    lastConnectedWaterM = adjacentFloat(lastConnectedWaterM, 1);
  }
  const lastConnected = evaluate(graph, source, target, lastConnectedWaterM, rateMmYear);
  const firstDisconnected = evaluate(graph, source, target, adjacentFloat(lastConnectedWaterM, 1), rateMmYear);
  assert.equal(lastConnected.status, "NETWORK_PATH");
  assert.equal(firstDisconnected.status, "NO_PATH");
  return { rateMmYear, nominalWaterM, lastConnected, firstDisconnected };
}

export async function analyzeRoutingThreshold() {
  const { graph, graphHash, manifest } = await loadRoutingData(), catalog = await getRoutingCatalog();
  const origin = catalog.origins.find((entry) => entry.id === "tumana")!;
  const destination = catalog.hospitals.find((entry) => entry.id === "way/54025002")!;
  const source = nearestRoadNode(graph, origin.coordinate), target = nearestRoadNode(graph, destination.coordinate);
  const threshold = findConnectivityThreshold(graph, source.index, target.index);
  assert.ok(threshold, "Selected anchors must have a path with known DSM coverage.");
  const unchanged = exactWaterBoundary(graph, source.index, target.index, threshold.minimumDsmM, 0);
  const lowered = exactWaterBoundary(graph, source.index, target.index, threshold.minimumDsmM, -30);
  const scan = Array.from({ length: 301 }, (_, tick) => {
    const waterLevelM = tick / 20;
    return { waterLevelM, unchanged: evaluate(graph, source.index, target.index, waterLevelM, 0), lowered: evaluate(graph, source.index, target.index, waterLevelM, -30) };
  });
  const contrasting = scan.filter((row) => row.unchanged.status === "NETWORK_PATH" && row.lowered.status === "NO_PATH");
  const suggested = scan.find((row) => row.waterLevelM === 11.6)!;
  assert.equal(suggested.unchanged.status, "NETWORK_PATH"); assert.equal(suggested.lowered.status, "NO_PATH");
  return {
    schemaVersion: 1,
    reproduction: "node scripts/analyze-routing-threshold.ts; node scripts/analyze-routing-threshold.ts --check",
    graphSha256: graphHash, sourceGraphSha256: manifest.sourceHashes.graphml,
    graphCounts: { nodes: graph.nodes.length, directedEdges: graph.edges.length },
    origin: { ...origin, snappedNodeIndex: source.index, snappedOsmNodeId: graph.nodes[source.index][0], snapDistanceM: source.distanceM },
    destination: { ...destination, snappedNodeIndex: target.index, snappedOsmNodeId: graph.nodes[target.index][0], snapDistanceM: target.distanceM },
    method: "Binary search over distinct known edge DSM minima, using directed breadth-first reachability independently of A*. Verify both adjacent IEEE-754 water values through the production strict minimumDsm < water + lowering - 0.30 predicate and A*.",
    units: "Water and DSM elevations are metres EGM2008; water level is not water depth or a river-gauge reading.",
    model: { closureDepthM: .30, rateMmYear: -30, elapsedYears: 13, uniformLoweringM: .39, unknownCoverage: "Excluded in both cases, separately from modeled depth closures." },
    threshold: {
      ...threshold,
      criticalEdges: threshold.criticalEdgeIds.map((id) => {
        const edge = graph.edges[id];
        return { id, fromOsmNodeId: graph.nodes[edge[0]][0], toOsmNodeId: graph.nodes[edge[1]][0], key: edge[2], name: edge[7], lengthM: edge[3], minimumDsmM: edge[4], geometryIndex: edge[6], coordinates: graph.geometries[edge[6]] };
      }),
      unchanged, lowered,
      sameWaterContrastIntervalM: { lowerExclusive: lowered.lastConnected.waterLevelM, upperInclusive: unchanged.lastConnected.waterLevelM },
      precisionNote: "Full precision reproduces this sampled-DSM graph and arithmetic; it does not imply surveyed elevation accuracy or an observed flood threshold. Critical edges form a separating cut, not proof of a single physical choke point.",
    },
    suggestedComparison: {
      waterLevelM: suggested.waterLevelM, unchanged: suggested.unchanged, lowered: suggested.lowered,
      additionalKnownClosedEdges: suggested.lowered.closedEdges - suggested.unchanged.closedEdges,
      wording: "At the same 11.6 m assumed water surface, 0.390 m of uniform DSM lowering changes the selected network result from a 27.876 km path to no path.",
    },
    scan: { startM: 0, endM: 15, stepM: .05, includesPointOneMetreGrid: true, contrastingWaterLevelsM: contrasting.map((row) => row.waterLevelM), records: scan },
    attribution: { network: "© OpenStreetMap contributors, ODbL-1.0. See data/network/NOTICE.txt.", surface: "Copernicus GLO-30 DSM; see data/NOTICE.txt and data/licenses/copernicus-dem-licenses.pdf.", licenseNote: "This deterministic derived research result retains source attribution; original data identities are unchanged." },
    limitations: ROUTING_LIMITATIONS,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await analyzeRoutingThreshold(), path = resolve("data/network/routing-threshold.json");
  if (process.argv.includes("--check")) assert.deepEqual(JSON.parse(await readFile(path, "utf8")), report);
  else await writeFile(path, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ artifact: path, checked: process.argv.includes("--check"), threshold: report.threshold.minimumDsmM, intervalM: report.threshold.sameWaterContrastIntervalM, comparison: report.suggestedComparison }, null, 2));
}

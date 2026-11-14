import type { Coordinate, RoadGraph } from "./graph.ts";
import { nearestRoadNode } from "./graph.ts";
import { correctedElevation } from "./elevation.ts";

export type ScenarioParameters = { waterLevelM: number; rateMmYear: number; elapsedYears: number };
type RouteFeature = { type: "Feature"; geometry: { type: "LineString"; coordinates: Coordinate[] }; properties: { role: string } };
type ClosureCollection = { type: "FeatureCollection"; features: { type: "Feature"; geometry: { type: "MultiLineString"; coordinates: Coordinate[][] }; properties: { role: string } }[] };
export type ScenarioState = ScenarioParameters & { verticalLoweringM: number; closureDepthM: 0.3; closedEdges: number; unknownEdges: number; excludedEdges: number; excluded: Uint8Array; closures: ClosureCollection; unknownClosures: ClosureCollection };
export type RouteResult = {
  status: "NETWORK_PATH" | "NO_PATH" | "NO_NEARBY_ROAD";
  lengthM: number | null; feature: RouteFeature | null; edgeIds: number[];
  solveMs: number; visitedNodes: number; snapStartM: number; snapEndM: number;
  sourceNode: number; targetNode: number; algorithm: "A*"; heuristicScale: number;
  timingScope: string; excludedEdges: number;
};
export type HospitalAnchor = { id: string; name: string; coordinate: Coordinate; sourceUrl: string };
export type RouteRequest = { origin: Coordinate; hospitalId: string; scenario: ScenarioParameters | null };
export type RoutingCatalog = {
  counts: { nodes: number; directedEdges: number; hospitalFeatures: number };
  origins: { id: string; name: string; coordinate: Coordinate }[];
  hospitals: HospitalAnchor[]; defaultHospitalId: string; limitations: string;
};
export type RouteResponse = {
  request: RouteRequest;
  baseline: RouteResult; scenarioRoute: RouteResult | null;
  scenarioSummary: (Omit<ScenarioState, "excluded"> & {
    closedEdgesWithoutLowering: number;
    additionalClosedEdges: number;
  }) | null;
  graph: { nodes: number; directedEdges: number; schemaVersion: number; sha256: string; sourceGraphSha256: string };
  receipt: { hostRecordedAt: string; clockBasis: string };
  destination: HospitalAnchor;
  limitations: string;
};
export const TIMING_SCOPE = "A* graph search only, including search-array allocation and path reconstruction; excludes graph loading, node snapping, scenario preparation, geometry and HTTP.";
export const ROUTING_LIMITATIONS = "Network-only path to the selected OSM hospital anchor. Road passability, vehicle access, hospital entrance, capacity and operation are unverified. Scenario depths use a uniform EGM2008 water surface over a lowered DSM, without hydraulics, drainage, bridges or barriers. A no-path result does not establish isolation from all hospitals.";

export function validateScenario(parameters: ScenarioParameters): void {
  const { waterLevelM, rateMmYear, elapsedYears } = parameters;
  if (![waterLevelM, rateMmYear, elapsedYears].every(Number.isFinite)
      || waterLevelM < -10 || waterLevelM > 100 || rateMmYear < -100 || rateMmYear > 0 || elapsedYears < 0 || elapsedYears > 100) {
    throw new RangeError("Scenario requires water -10…100 m EGM2008, lowering rate -100…0 mm/yr and elapsed time 0…100 yr.");
  }
}

/** Unknown coverage is excluded separately; it never becomes a flood observation. */
export function prepareScenario(graph: RoadGraph, parameters: ScenarioParameters, includeGeometry = true): ScenarioState {
  validateScenario(parameters);
  const excluded = new Uint8Array(graph.edges.length);
  const verticalLoweringM = -correctedElevation(0, parameters.rateMmYear, parameters.elapsedYears)!;
  // Algebraically depth > .30; comparing heights preserves equality at the cutoff.
  const cutoffSurfaceM = parameters.waterLevelM + verticalLoweringM - .30;
  const closedShapes = new Set<number>(), unknownShapes = new Set<number>();
  let closedEdges = 0, unknownEdges = 0;
  graph.edges.forEach((edge, index) => {
    if (edge[4] === null || edge[5] > 0) {
      excluded[index] = 1; unknownEdges++; if (includeGeometry) unknownShapes.add(edge[6]);
    } else if (edge[4] < cutoffSurfaceM) {
      excluded[index] = 1; closedEdges++; if (includeGeometry) closedShapes.add(edge[6]);
    }
  });
  const collection = (ids: Set<number>, role: string): ClosureCollection => ({ type: "FeatureCollection", features: ids.size ? [{ type: "Feature", geometry: { type: "MultiLineString", coordinates: [...ids].map((id) => graph.geometries[id]) }, properties: { role } }] : [] });
  return { ...parameters, verticalLoweringM, closureDepthM: .3, closedEdges, unknownEdges, excludedEdges: closedEdges + unknownEdges, excluded, closures: collection(closedShapes, "modeled depth above 0.30 m; not observed closure"), unknownClosures: collection(unknownShapes, "unknown DSM coverage; conservatively excluded") };
}

type QueueEntry = { estimate: number; cost: number; node: number };
class MinHeap {
  private entries: QueueEntry[] = [];
  get length() { return this.entries.length; }
  private less(a: QueueEntry, b: QueueEntry) { return a.estimate < b.estimate || (a.estimate === b.estimate && (a.cost < b.cost || (a.cost === b.cost && a.node < b.node))); }
  push(value: QueueEntry) {
    let i = this.entries.length; this.entries.push(value);
    while (i > 0) { const parent = (i - 1) >> 1; if (!this.less(value, this.entries[parent])) break; this.entries[i] = this.entries[parent]; i = parent; }
    this.entries[i] = value;
  }
  pop(): QueueEntry {
    const result = this.entries[0], last = this.entries.pop()!;
    if (this.entries.length) {
      let i = 0;
      while (2 * i + 1 < this.entries.length) {
        let child = 2 * i + 1;
        if (child + 1 < this.entries.length && this.less(this.entries[child + 1], this.entries[child])) child++;
        if (!this.less(this.entries[child], last)) break;
        this.entries[i] = this.entries[child]; i = child;
      }
      this.entries[i] = last;
    }
    return result;
  }
}

/** Conventional A* on nonnegative edge lengths; the heuristic is admissible and consistent. */
export function searchGraph(graph: RoadGraph, source: number, target: number, excluded?: Uint8Array): { edgeIds: number[] | null; lengthM: number | null; visitedNodes: number } {
  if (![source, target].every((i) => Number.isInteger(i) && i >= 0 && i < graph.nodes.length) || (excluded && excluded.length !== graph.edges.length)) throw new RangeError("Invalid graph search indices or exclusion mask.");
  const targetXY = graph.nodes[target];
  const heuristic = (node: number) => Math.hypot(graph.nodes[node][3] - targetXY[3], graph.nodes[node][4] - targetXY[4]) * graph.heuristicScale;
  const costs = new Float64Array(graph.nodes.length).fill(Infinity), previous = new Int32Array(graph.nodes.length).fill(-1);
  costs[source] = 0;
  const queue = new MinHeap(); queue.push({ estimate: heuristic(source), cost: 0, node: source });
  let visitedNodes = 0;
  while (queue.length) {
    const { node, cost } = queue.pop();
    if (cost > costs[node]) continue;
    visitedNodes++;
    if (node === target) {
      const edgeIds = []; let cursor = target;
      while (cursor !== source) { const edgeId = previous[cursor]; edgeIds.push(edgeId); cursor = graph.edges[edgeId][0]; }
      return { edgeIds: edgeIds.reverse(), lengthM: cost, visitedNodes };
    }
    for (const edgeId of graph.adjacency[node]) {
      if (excluded?.[edgeId]) continue;
      const edge = graph.edges[edgeId], next = cost + edge[3];
      if (next < costs[edge[1]]) { costs[edge[1]] = next; previous[edge[1]] = edgeId; queue.push({ estimate: next + heuristic(edge[1]), cost: next, node: edge[1] }); }
    }
  }
  return { edgeIds: null, lengthM: null, visitedNodes };
}

export function solveRoute(graph: RoadGraph, start: Coordinate, end: Coordinate, scenario?: ScenarioState): RouteResult {
  const source = nearestRoadNode(graph, start), target = nearestRoadNode(graph, end);
  const common = { sourceNode: graph.nodes[source.index][0], targetNode: graph.nodes[target.index][0], snapStartM: source.distanceM, snapEndM: target.distanceM, algorithm: "A*" as const, heuristicScale: graph.heuristicScale, timingScope: TIMING_SCOPE, excludedEdges: scenario?.excludedEdges ?? 0 };
  if (Math.max(source.distanceM, target.distanceM) > 1000) return { ...common, status: "NO_NEARBY_ROAD", lengthM: null, feature: null, edgeIds: [], solveMs: 0, visitedNodes: 0 };
  const started = performance.now();
  const result = searchGraph(graph, source.index, target.index, scenario?.excluded);
  const solveMs = performance.now() - started;
  if (!result.edgeIds) return { ...common, status: "NO_PATH", lengthM: null, feature: null, edgeIds: [], solveMs, visitedNodes: result.visitedNodes };
  const coordinates: Coordinate[] = [];
  for (const id of result.edgeIds) {
    const edge = graph.edges[id], node = graph.nodes[edge[0]], line = graph.geometries[edge[6]];
    const distance = (p: Coordinate) => Math.hypot(p[0] - node[1], p[1] - node[2]);
    const oriented = distance(line.at(-1)!) < distance(line[0]) ? [...line].reverse() : line;
    coordinates.push(...(coordinates.length ? oriented.slice(1) : oriented));
  }
  if (!coordinates.length) { const node = graph.nodes[source.index]; coordinates.push([node[1], node[2]], [node[1], node[2]]); }
  return { ...common, ...result, edgeIds: result.edgeIds, status: "NETWORK_PATH", solveMs, feature: { type: "Feature", geometry: { type: "LineString", coordinates }, properties: { role: scenario ? "modeled-depth-screened network path" : "topology-only network path" } } };
}

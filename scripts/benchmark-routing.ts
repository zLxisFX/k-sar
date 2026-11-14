import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadRoutingData, getRoutingCatalog } from "../src/server/routing-loader.ts";
import { prepareScenario, searchGraph, TIMING_SCOPE } from "../src/domain/routing.ts";
import { nearestRoadNode } from "../src/domain/graph.ts";

const { graph, graphHash, manifest } = await loadRoutingData();
const catalog = await getRoutingCatalog();
const destination = catalog.hospitals.find((hospital) => hospital.id === catalog.defaultHospitalId)!;
const target = nearestRoadNode(graph, destination.coordinate).index;
const cases = catalog.origins.map((origin) => ({ origin, scenario: null as null | { waterLevelM: number; rateMmYear: number; elapsedYears: number } }));
for (const waterLevelM of [10, 12]) cases.push({ origin: catalog.origins[0], scenario: { waterLevelM, rateMmYear: -30, elapsedYears: 13 } });
const records = cases.map(({ origin, scenario }) => {
  const source = nearestRoadNode(graph, origin.coordinate).index;
  const state = scenario ? prepareScenario(graph, scenario, false) : undefined;
  for (let i = 0; i < 10; i++) searchGraph(graph, source, target, state?.excluded);
  const times = [];
  let result = searchGraph(graph, source, target, state?.excluded);
  for (let i = 0; i < 30; i++) {
    const started = performance.now();
    result = searchGraph(graph, source, target, state?.excluded);
    times.push(performance.now() - started);
  }
  const sorted = [...times].sort((a, b) => a - b);
  return { origin, destination, scenario, status: result.edgeIds === null ? "NO_PATH" : "NETWORK_PATH", lengthM: result.lengthM, visitedNodes: result.visitedNodes, closedEdges: state?.closedEdges ?? 0, unknownEdges: state?.unknownEdges ?? 0, excludedEdges: state?.excludedEdges ?? 0, runs: 30, warmupRuns: 10, medianSolveMs: (sorted[14] + sorted[15]) / 2, minimumSolveMs: sorted[0], maximumSolveMs: sorted.at(-1), samplesMs: times };
});
const sourceUrl = "https://cmr.earthdata.nasa.gov/search/collections.json?page_size=1";
const clock = await fetch(sourceUrl, { headers: { "Cache-Control": "no-cache" } });
if (!clock.ok || !clock.headers.get("date")) throw new Error("External benchmark timestamp is unavailable; report not written.");
const report = {
  schemaVersion: 1, measuredAt: new Date(clock.headers.get("date")!).toISOString(), timestampSource: sourceUrl, httpDate: clock.headers.get("date"),
  hostRecordedAt: new Date().toISOString(), clockNote: "Host clock is offset; measuredAt uses provider HTTPS response Date after benchmark.",
  algorithm: "Conventional A*; length-weighted directed multigraph, admissible scaled Euclidean heuristic in EPSG:32651",
  heuristicScale: graph.heuristicScale, timingScope: TIMING_SCOPE,
  runtime: { node: process.version, platform: process.platform, architecture: process.arch },
  graphSha256: graphHash, sourceGraphSha256: manifest.sourceHashes.graphml, records,
  comparisonNote: "Fresh TypeScript measurements on this workstation. Historical Python A* medians 0.216/0.304 ms and single 22.2695 ms detour timing are not current benchmarks; old Dijkstra numbers use a different algorithm and are not a like-for-like comparison.",
};
await writeFile(join(process.cwd(), "data/network/benchmark-current.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ measuredAt: report.measuredAt, records: records.map(({ origin, scenario, medianSolveMs, lengthM, status, excludedEdges }) => ({ origin: origin.name, scenario, medianSolveMs, lengthM, status, excludedEdges })) }, null, 2));

import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { buildRoadGraph } from "../domain/graph.ts";
import type { RoadGraph, RoadGraphData, Coordinate } from "../domain/graph.ts";
import type { HospitalAnchor, RoutingCatalog, RouteRequest, RouteResponse } from "../domain/routing.ts";
import { prepareScenario, solveRoute, ROUTING_LIMITATIONS, validateScenario } from "../domain/routing.ts";
import { validateCoordinate } from "../domain/graph.ts";

type NetworkManifest = { schemaVersion: number; sourceHashes: { graphml: string }; files: { path: string; sha256: string }[] };
type RoutingData = { graph: RoadGraph; manifest: NetworkManifest; graphHash: string; hospitals: HospitalAnchor[] };
let cached: Promise<RoutingData> | undefined;

/** Only checked local files are loaded; source hash mismatches fail closed. */
export function loadRoutingData(): Promise<RoutingData> {
  cached ??= (async () => {
    const directory = join(process.cwd(), "data/network");
    const [raw, metadata, hospitalText] = await Promise.all([
      readFile(join(directory, "graph.json.gz")), readFile(join(directory, "manifest.json"), "utf8"), readFile(join(directory, "hospitals.geojson"), "utf8"),
    ]);
    const manifest: NetworkManifest = JSON.parse(metadata);
    const graphHash = createHash("sha256").update(raw).digest("hex");
    if (graphHash !== manifest.files.find((file) => file.path === "graph.json.gz")?.sha256) throw new Error("Network data checksum mismatch.");
    if (createHash("sha256").update(hospitalText).digest("hex") !== manifest.files.find((file) => file.path === "hospitals.geojson")?.sha256) throw new Error("Hospital data checksum mismatch.");
    const graph = buildRoadGraph(JSON.parse(gunzipSync(raw).toString("utf8")) as RoadGraphData);
    const source: { features: { geometry: { coordinates: Coordinate }; properties: { osm_type: string; osm_id: number; name: string; source_url: string } }[] } = JSON.parse(hospitalText);
    const hospitals = source.features.map(({ geometry, properties }) => ({ id: `${properties.osm_type}/${properties.osm_id}`, name: properties.name, coordinate: geometry.coordinates, sourceUrl: properties.source_url }));
    for (const hospital of hospitals) validateCoordinate(hospital.coordinate);
    return { graph, manifest, graphHash, hospitals };
  })().catch((error: unknown) => { cached = undefined; throw error; });
  return cached;
}

export async function getRoutingCatalog(): Promise<RoutingCatalog> {
  const { graph, hospitals } = await loadRoutingData();
  return {
    counts: { nodes: graph.nodes.length, directedEdges: graph.edges.length, hospitalFeatures: hospitals.length },
    origins: [
      { id: "tumana", name: "Tumana", coordinate: [121.09593983925672, 14.6580158] },
      { id: "malanday", name: "Malanday", coordinate: [121.09379427092635, 14.64796565] },
    ], hospitals, defaultHospitalId: "way/54025002", limitations: ROUTING_LIMITATIONS,
  };
}

export function parseRouteRequest(value: unknown): RouteRequest {
  if (!value || typeof value !== "object") throw new RangeError("Expected a route request object.");
  const candidate = value as Record<string, unknown>;
  validateCoordinate(candidate.origin as Coordinate);
  if (typeof candidate.hospitalId !== "string" || candidate.hospitalId.length > 80) throw new RangeError("Choose an OSM hospital anchor.");
  let scenario = null;
  if (candidate.scenario !== null && candidate.scenario !== undefined) {
    if (typeof candidate.scenario !== "object") throw new RangeError("Invalid scenario parameters.");
    const p = candidate.scenario as Record<string, unknown>;
    scenario = { waterLevelM: p.waterLevelM as number, rateMmYear: p.rateMmYear as number, elapsedYears: p.elapsedYears as number };
    validateScenario(scenario);
  }
  return { origin: [...candidate.origin as Coordinate], hospitalId: candidate.hospitalId, scenario };
}

export async function computeRoute(request: RouteRequest): Promise<RouteResponse> {
  request = parseRouteRequest(request);
  const { graph, manifest, graphHash, hospitals } = await loadRoutingData();
  const destination = hospitals.find((hospital) => hospital.id === request.hospitalId);
  if (!destination) throw new RangeError("The selected OSM hospital anchor is not in this extract.");
  const baseline = solveRoute(graph, request.origin, destination.coordinate);
  const scenario = request.scenario ? prepareScenario(graph, request.scenario) : null;
  const scenarioRoute = scenario ? solveRoute(graph, request.origin, destination.coordinate, scenario) : null;
  const scenarioSummary = scenario ? (() => {
    const { excluded: _excluded, ...summary } = scenario;
    const reference = prepareScenario(graph, {
      waterLevelM: scenario.waterLevelM, rateMmYear: 0, elapsedYears: scenario.elapsedYears,
    }, false);
    return {
      ...summary,
      closedEdgesWithoutLowering: reference.closedEdges,
      additionalClosedEdges: scenario.closedEdges - reference.closedEdges,
    };
  })() : null;
  return {
    request, baseline, scenarioRoute, scenarioSummary, destination,
    graph: { nodes: graph.nodes.length, directedEdges: graph.edges.length, schemaVersion: manifest.schemaVersion, sha256: graphHash, sourceGraphSha256: manifest.sourceHashes.graphml },
    receipt: { hostRecordedAt: new Date().toISOString(), clockBasis: "Workstation clock, previously observed about eight hours behind provider HTTP time; not a trusted acquisition or UTC retrieval timestamp." },
    limitations: ROUTING_LIMITATIONS,
  };
}

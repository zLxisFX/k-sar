import proof from "../../data/network/routing-threshold.json" with { type: "json" };
import type { Coordinate } from "./graph.ts";
import type { RouteResponse } from "./routing.ts";

/** The cut is specific to this graph, direction, selected anchors and paired scenario. */
export function tippingBottleneck(route: RouteResponse | null) {
  const scenario = route?.request.scenario;
  if (
    !route || !scenario || route.graph.sha256 !== proof.graphSha256 ||
    route.request.hospitalId !== proof.destination.id ||
    !route.request.origin.every((value, index) => value === proof.origin.coordinate[index]) ||
    scenario.waterLevelM !== proof.suggestedComparison.waterLevelM ||
    scenario.elapsedYears !== proof.model.elapsedYears ||
    ![0, proof.model.rateMmYear].includes(scenario.rateMmYear) ||
    route.withoutLoweringRoute?.status !== "NETWORK_PATH" ||
    !proof.threshold.criticalEdgeIds.every((id) => route.withoutLoweringRoute!.edgeIds.includes(id))
  ) return null;
  const excluded = scenario.rateMmYear === proof.model.rateMmYear;
  if (route.scenarioRoute?.status !== (excluded ? "NO_PATH" : "NETWORK_PATH")) return null;
  return {
    excluded,
    proofUrl: "/data/network/routing-threshold.json",
    edges: proof.threshold.criticalEdges.map((edge) => ({
      id: edge.id,
      name: edge.name,
      minimumDsmM: edge.minimumDsmM,
      coordinates: edge.coordinates.map(([lon, lat]): Coordinate => [lon, lat]),
    })),
  };
}

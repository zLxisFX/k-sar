import type { Coordinate } from "./graph.ts";
import { validateCoordinate } from "./graph.ts";
import type { RouteRequest, RouteResponse, ScenarioParameters } from "./routing.ts";
import { validateScenario } from "./routing.ts";

export type SessionState = {
  datasets: { id: string; sha256: string }[];
  view: {
    center: Coordinate; zoom: number; curtainPercent: number;
    selectedCoordinate: Coordinate | null; transectIndex: number | null;
    layers: { radar: boolean; roadNetwork: boolean; crossSection: boolean };
  };
  surfacePreview: ScenarioParameters;
  requestedRoute: RouteRequest | null;
  appliedRoute: RouteResponse | null;
  calculationPending: boolean;
};

function finiteJson(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || ancestors.has(value)) throw new TypeError("Session contains a non-JSON value or circular reference.");
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError("Session requires plain JSON records.");
  ancestors.add(value);
  for (const entry of Object.values(value)) finiteJson(entry, ancestors);
  ancestors.delete(value);
}

export function serializeSession(state: SessionState, recordedAtClient: string): string {
  finiteJson(state);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(recordedAtClient) || !Number.isFinite(Date.parse(recordedAtClient))) throw new RangeError("Use an ISO client timestamp.");
  validateCoordinate(state.view.center);
  if (state.view.selectedCoordinate) validateCoordinate(state.view.selectedCoordinate);
  if (state.view.zoom < 0 || state.view.zoom > 24 || state.view.curtainPercent < 0 || state.view.curtainPercent > 100
    || (state.view.transectIndex !== null && (!Number.isInteger(state.view.transectIndex) || state.view.transectIndex < 0 || state.view.transectIndex > 58))) throw new RangeError("Invalid map or transect state.");
  const layers = state.view.layers;
  if (!layers || typeof layers.radar !== "boolean" || typeof layers.roadNetwork !== "boolean" || typeof layers.crossSection !== "boolean") {
    throw new TypeError("Session layer visibility requires radar, roadNetwork and crossSection booleans.");
  }
  if (!state.surfacePreview || typeof state.surfacePreview !== "object") throw new TypeError("Session requires surface preview parameters.");
  validateScenario(state.surfacePreview);
  for (const dataset of state.datasets) {
    if (!dataset.id || !/^[a-f0-9]{64}$/.test(dataset.sha256)) throw new RangeError("Dataset identities require SHA-256 hashes.");
  }
  if (!state.datasets.length) throw new RangeError("A session must identify its source data.");
  if (state.requestedRoute) {
    validateCoordinate(state.requestedRoute.origin);
    if (state.requestedRoute.scenario) validateScenario(state.requestedRoute.scenario);
  }
  return JSON.stringify({ schemaVersion: 2, recordedAtClient, clockVerified: false, ...state }, null, 2) + "\n";
}

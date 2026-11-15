import type { ScenarioParameters } from "./routing.ts";

type PresetControls = {
  originId: string;
  hospitalId: string;
  parameters: ScenarioParameters;
  scenarioOn: boolean;
};

export const PRESET_SCOPE = {
  originId: "tumana",
  hospitalId: "way/54025002",
  label: "Tumana → Amang Rodriguez Memorial Medical Center",
} as const;

export const ROUTE_PRESETS = [
  {
    id: "baseline",
    label: "Baseline",
    detail: "3.726 km",
    parameters: { waterLevelM: 0, rateMmYear: 0, elapsedYears: 13 },
    scenarioOn: false,
    reference: "3.726 km network path; no flood exclusions.",
  },
  {
    id: "water-10",
    label: "10 m water",
    detail: "27.876 km",
    parameters: { waterLevelM: 10, rateMmYear: -30, elapsedYears: 13 },
    scenarioOn: true,
    reference: "0.390 m lowering · 27.876 km path · 56,568 depth closures · +1,432 from lowering.",
  },
  {
    id: "water-12",
    label: "12 m water",
    detail: "No path",
    parameters: { waterLevelM: 12, rateMmYear: -30, elapsedYears: 13 },
    scenarioOn: true,
    reference: "0.390 m lowering · no network path to this selected hospital anchor.",
  },
] as const;

export function matchingRoutePreset(controls: PresetControls) {
  if (
    controls.originId !== PRESET_SCOPE.originId ||
    controls.hospitalId !== PRESET_SCOPE.hospitalId
  )
    return null;
  return (
    ROUTE_PRESETS.find(
      (preset) =>
        controls.scenarioOn === preset.scenarioOn &&
        controls.parameters.waterLevelM === preset.parameters.waterLevelM &&
        controls.parameters.rateMmYear === preset.parameters.rateMmYear &&
        controls.parameters.elapsedYears === preset.parameters.elapsedYears,
    ) ?? null
  );
}

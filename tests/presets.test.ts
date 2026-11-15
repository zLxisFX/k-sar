import test from "node:test";
import assert from "node:assert/strict";
import {
  PRESET_SCOPE,
  ROUTE_PRESETS,
  matchingRoutePreset,
} from "../src/domain/presets.ts";
import {
  computeRoute,
  getRoutingCatalog,
} from "../src/server/routing-loader.ts";

test("reference selection requires the exact route scope and every control value", () => {
  for (const preset of ROUTE_PRESETS) {
    const controls = {
      ...PRESET_SCOPE,
      parameters: { ...preset.parameters },
      scenarioOn: preset.scenarioOn,
    };
    assert.equal(matchingRoutePreset(controls)?.id, preset.id);
    assert.equal(
      matchingRoutePreset({ ...controls, originId: "malanday" }),
      null,
    );
    assert.equal(
      matchingRoutePreset({ ...controls, hospitalId: "node/25389198" }),
      null,
    );
    assert.equal(
      matchingRoutePreset({ ...controls, scenarioOn: !controls.scenarioOn }),
      null,
    );
    for (const field of [
      "waterLevelM",
      "rateMmYear",
      "elapsedYears",
    ] as const) {
      assert.equal(
        matchingRoutePreset({
          ...controls,
          parameters: {
            ...controls.parameters,
            [field]: controls.parameters[field] + 0.5,
          },
        }),
        null,
      );
    }
  }
});

test("baseline is topology-only and does not preserve a lowering preview", () => {
  const baseline = ROUTE_PRESETS.find((preset) => preset.id === "baseline")!;
  assert.equal(baseline.scenarioOn, false);
  assert.equal(baseline.parameters.rateMmYear, 0);
  assert.equal(baseline.parameters.waterLevelM, 0);
  assert.equal(
    matchingRoutePreset({
      ...PRESET_SCOPE,
      parameters: ROUTE_PRESETS[1].parameters,
      scenarioOn: false,
    }),
    null,
  );
});

test("all reference buttons reproduce their claims on the imported graph and selected OSM anchor", async () => {
  const catalog = await getRoutingCatalog();
  const origin = catalog.origins.find(
    (item) => item.id === PRESET_SCOPE.originId,
  )!;
  assert.deepEqual(origin.coordinate, [121.09593983925672, 14.6580158]);
  assert.ok(
    catalog.hospitals
      .find((item) => item.id === PRESET_SCOPE.hospitalId)
      ?.name.includes("Amang Rodriguez"),
  );
  const results = await Promise.all(
    ROUTE_PRESETS.map((preset) =>
      computeRoute({
        origin: origin.coordinate,
        hospitalId: PRESET_SCOPE.hospitalId,
        scenario: preset.scenarioOn ? preset.parameters : null,
      }),
    ),
  );
  assert.ok(Math.abs(results[0].baseline.lengthM! - 3726.297134241261) < 0.001);
  assert.equal(results[0].scenarioRoute, null);
  assert.equal(results[0].scenarioSummary, null);
  assert.ok(
    Math.abs(results[1].scenarioRoute!.lengthM! - 27875.63395980343) < 0.001,
  );
  assert.equal(results[1].scenarioSummary!.verticalLoweringM, 0.39);
  assert.equal(results[1].scenarioSummary!.closedEdges, 56568);
  assert.equal(results[1].scenarioSummary!.additionalClosedEdges, 1432);
  assert.equal(results[1].scenarioSummary!.unknownEdges, 6);
  assert.equal(results[2].scenarioRoute!.status, "NO_PATH");
  assert.equal(results[2].scenarioRoute!.feature, null);
  assert.equal(results[2].destination.id, PRESET_SCOPE.hospitalId);
  assert.ok(
    Math.abs(results[3].scenarioRoute!.lengthM! - 27875.63395980343) < 0.001,
  );
  assert.equal(results[3].scenarioSummary!.closedEdges, 61848);
  assert.equal(results[4].scenarioRoute!.status, "NO_PATH");
  assert.equal(results[4].scenarioSummary!.closedEdges, 63408);
  assert.equal(results[4].scenarioSummary!.additionalClosedEdges, 1560);
});

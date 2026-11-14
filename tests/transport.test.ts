import test from "node:test";
import assert from "node:assert/strict";
import { jsonStreamResponse } from "../src/server/json-response.ts";
import { computeRoute } from "../src/server/routing-loader.ts";

const payload = { text: "Marikina Δγ⁰ — river / ".repeat(220_000), unchanged: [null, false, 0, -0.39] };

test("large Unicode JSON stays plain and lossless regardless of browser compression headers", async () => {
  for (const accept of [null, "gzip, deflate, br", "identity"]) {
    const response = jsonStreamResponse(payload, new Request("http://localhost/api/route", { headers: accept ? { "Accept-Encoding": accept } : {} }));
    assert.equal(response.headers.get("Content-Encoding"), null);
    assert.equal(response.headers.get("Content-Length"), null);
    const chunks = [];
    for await (const chunk of response.body!) chunks.push(Buffer.from(chunk));
    assert.ok(chunks.length > 1, "Response must emit multiple chunks");
    const bytes = Buffer.concat(chunks);
    assert.deepEqual(JSON.parse(bytes.toString("utf8")), payload);
    assert.notEqual(bytes[0], 0x1f, "Do not send gzip bytes for the platform to encode again");
  }
});

test("an aborted request terminates its response stream", async () => {
  const controller = new AbortController();
  const response = jsonStreamResponse(payload, new Request("http://localhost/api/route", { signal: controller.signal }));
  controller.abort();
  await assert.rejects(() => response.arrayBuffer(), /aborted/i);
});

test("real default, no-path and maximum supported scenarios remain directly parseable streamed JSON", async () => {
  for (const [waterLevelM, rateMmYear, elapsedYears] of [[10, -30, 13], [12, -30, 13], [15, -50, 30], [100, -100, 100]]) {
    const route = await computeRoute({ origin: [121.09593983925672, 14.6580158], hospitalId: "way/54025002", scenario: { waterLevelM, rateMmYear, elapsedYears } });
    const response = jsonStreamResponse(route, new Request("http://localhost/api/route", { headers: { "Accept-Encoding": "gzip" } }));
    assert.equal(response.headers.get("Content-Encoding"), null);
    const browserResult = response.clone().json();
    const decoded = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(await browserResult, route);
    assert.deepEqual(JSON.parse(decoded.toString("utf8")), route);
    assert.equal(route.graph.sourceGraphSha256, "4c4a8eb4138c1d8f452e92422a5f43860bdd1ee0f19763f0ac406f0dfaf3e7e4");
    assert.equal(route.scenarioSummary?.unknownEdges, 6);
    assert.equal(route.scenarioRoute?.status, waterLevelM === 10 ? "NETWORK_PATH" : "NO_PATH");
    if (waterLevelM === 100) assert.ok(decoded.length > 4_500_000, "Exercise a response above the buffered platform limit");
  }
});

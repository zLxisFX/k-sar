import { computeRoute, getRoutingCatalog, parseRouteRequest } from "../../../server/routing-loader.ts";
import { jsonStreamResponse } from "../../../server/json-response.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try { return Response.json(await getRoutingCatalog(), { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "The checked local road network could not be loaded." }, { status: 503 }); }
}

export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length")) > 4096) return Response.json({ error: "Route request is too large." }, { status: 413 });
    const text = await request.text();
    if (text.length > 4096) return Response.json({ error: "Route request is too large." }, { status: 413 });
    const input = parseRouteRequest(JSON.parse(text));
    return jsonStreamResponse(await computeRoute(input), request);
  } catch (error) {
    const invalid = error instanceof RangeError || error instanceof SyntaxError;
    return Response.json({ error: invalid ? error.message : "Route computation is unavailable. No route safety is implied." }, { status: invalid ? 400 : 503 });
  }
}

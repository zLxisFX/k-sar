import { readFile } from "node:fs/promises";
import { join } from "node:path";
import manifest from "@data/nasa/nisar/manifest.json";

const allowedAssets = new Map<string, string>([
  ["network/roads-display.geojson", "application/geo+json"],
  ["network/waterways.geojson", "application/geo+json"],
  ["network/waterways-provenance.json", "application/json"],
  ["network/hospitals.geojson", "application/geo+json"],
  ["network/manifest.json", "application/json"],
  ["network/NOTICE.txt", "text/plain; charset=utf-8"],
  ["network/odbl-1.0.html", "text/html; charset=utf-8"],
  ["network/graph.json.gz", "application/gzip"],
  ["NOTICE.txt", "text/plain; charset=utf-8"],
  ["licenses/cc-by-4.0.txt", "text/plain; charset=utf-8"],
  ["licenses/sentinel-data-legal-notice.pdf", "application/pdf"],
  ["licenses/copernicus-dem-licenses.pdf", "application/pdf"],
  ["licenses/sentinel-1-rtc-collection.json", "application/json"],
  ["licenses/sources.json", "application/json"],
  ["sentinel-1/baseline.tif", "image/tiff"],
  ["sentinel-1/post.tif", "image/tiff"],
  ["sentinel-1/dem.tif", "image/tiff"],
  ["sentinel-1/manifest.json", "application/json"],
  ["transect/reference.json", "application/json"],
  ["nasa/nisar/manifest.json", "application/json"],
  ["nasa/nisar/footprints.geojson", "application/geo+json"],
  [`nasa/nisar/${manifest.collection.metadata.path}`, "application/json"],
  ...manifest.records.map((record): [string, string] => [
    `nasa/nisar/${record.browse.path}`,
    "image/png",
  ]),
  ...manifest.records.map((record): [string, string] => [
    `nasa/nisar/${record.metadata.path}`,
    "application/json",
  ]),
]);

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ asset: string[] }>;
  },
) {
  const { asset } = await params;
  const relativePath = asset.join("/");
  const contentType = allowedAssets.get(relativePath);
  if (!contentType)
    return new Response("Data asset not found", { status: 404 });

  try {
    const bytes = await readFile(join(process.cwd(), "data", relativePath));
    return new Response(bytes, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Research data asset is unavailable", { status: 503 });
  }
}

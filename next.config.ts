import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  headers() {
    return ["/Project_K-SAR_2026_Final.pdf", "/Project_K-SAR_2026_Deck.pdf"].map((source) => ({
      source,
      headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
    }));
  },
  outputFileTracingIncludes: {
    "/api/route": ["./data/network/graph.json.gz", "./data/network/hospitals.geojson", "./data/network/manifest.json"],
  },
  outputFileTracingExcludes: {
    "/api/route": ["./public/data/**/*", "./data/network/roads-display.geojson", "./data/network/waterways.geojson", "./data/network/benchmark-current.json", "./data/network/*NOTICE*", "./data/network/odbl-1.0.html", "./data/network/source-*.json", "./data/network/waterways-provenance.json"],
  },
};

export default nextConfig;

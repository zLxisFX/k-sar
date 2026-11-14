import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/api/route": ["./data/network/graph.json.gz", "./data/network/hospitals.geojson", "./data/network/manifest.json"],
  },
  outputFileTracingExcludes: {
    "/api/route": ["./public/data/**/*", "./data/network/roads-display.geojson", "./data/network/waterways.geojson", "./data/network/benchmark-current.json", "./data/network/*NOTICE*", "./data/network/odbl-1.0.html", "./data/network/source-*.json", "./data/network/waterways-provenance.json"],
  },
};

export default nextConfig;

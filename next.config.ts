import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/data/*": ["./data/sentinel-1/*.tif", "./data/sentinel-1/manifest.json", "./data/transect/reference.json", "./data/nasa/nisar/**/*.json", "./data/nasa/nisar/*.geojson", "./data/nasa/nisar/browse/*.png"],
  },
};

export default nextConfig;

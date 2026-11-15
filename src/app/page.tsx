import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CatalogFootprint } from "@/domain/research";
import ResearchWorkspace from "@/components/ResearchWorkspace";
import nisar from "@data/nasa/nisar/manifest.json";
import transect from "@data/transect/reference.json";
export default async function Page() {
  const [footprintBytes, transectBytes, comparisonBytes] = await Promise.all([
    readFile(join(process.cwd(), "data/nasa/nisar/footprints.geojson"), "utf8"),
    readFile(join(process.cwd(), "data/transect/reference.json")),
    readFile(join(process.cwd(), "data/nasa/nisar/comparison/manifest.json")),
  ]);
  const footprints: { features: CatalogFootprint[] } =
    JSON.parse(footprintBytes);
  const transectHash = createHash("sha256").update(transectBytes).digest("hex");
  return (
    <ResearchWorkspace
      studyArea={{
        name: "Marikina–Pasig basin",
        country: "Philippines",
        geographicCrs: "EPSG:4326",
      }}
      transect={transect}
      transectHash={transectHash}
      nisarComparisonHash={createHash("sha256")
        .update(comparisonBytes)
        .digest("hex")}
      nisarRecords={nisar.records}
      nisarInterval={nisar.intervalDays}
      footprints={footprints.features}
    />
  );
}

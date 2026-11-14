import type { StudyArea } from "@/domain/geospatial";
import type { CatalogFootprint } from "@/domain/research";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import NisarReference from "@/components/NisarReference";
import RasterInspector from "@/components/RasterInspector";
import nisar from "@data/nasa/nisar/manifest.json";
import transect from "@data/transect/reference.json";

const studyArea: StudyArea = {
  name: "Marikina–Pasig basin",
  country: "Philippines",
  geographicCrs: "EPSG:4326",
};

export default async function Page() {
  const footprints: { features: CatalogFootprint[] } = JSON.parse(
    await readFile(join(process.cwd(), "data/nasa/nisar/footprints.geojson"), "utf8"),
  );
  return (
    <>
      <header className="masthead">
        <a className="wordmark" href="/" aria-label="K-SAR home">K-SAR</a>
        <span>{studyArea.name}</span>
        <span className="version">Research workspace</span>
      </header>
      <main>
        <div className="workspace-heading">
          <div><p className="section-kicker">{studyArea.country} / {studyArea.geographicCrs}</p><h1>Radar and surface evidence</h1></div>
          <p>Inspect the source imagery and measured samples before applying a scenario.</p>
        </div>
        <NisarReference records={nisar.records} intervalDays={nisar.intervalDays} footprints={footprints.features} />
        <RasterInspector transect={transect} />
        <footer>
          <span>Project K-SAR · Research prototype</span>
          <span>NASA reference imagery, Sentinel-1 observations and elevation scenarios remain separate.</span>
          <a href="/data/transect/reference.json" download>Download transect</a>
        </footer>
      </main>
    </>
  );
}

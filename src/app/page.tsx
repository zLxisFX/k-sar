import type { DatasetScope, EvidenceKind, StudyArea } from "@/domain/geospatial";

const studyArea: StudyArea = {
  name: "Marikina–Pasig basin",
  country: "Philippines",
  geographicCrs: "EPSG:4326",
};

const evidenceLabels: Record<EvidenceKind, string> = {
  observation: "Radar observation",
  "surface-model": "Elevation model",
  "mapped-network": "Mapped network",
};

const datasetScope: readonly DatasetScope[] = [
  {
    id: "sentinel-1",
    name: "Sentinel-1 RTC",
    evidence: "observation",
    interpretation: "Compare calibrated radar backscatter between dated acquisitions.",
    referenceGrid: { width: 854, height: 998, pixelSizeMeters: [30, 30] },
  },
  {
    id: "copernicus-dem",
    name: "Copernicus DEM GLO-30",
    evidence: "surface-model",
    interpretation: "Reference surface for parameterized water-level and subsidence scenarios.",
  },
  {
    id: "openstreetmap",
    name: "OpenStreetMap",
    evidence: "mapped-network",
    interpretation: "Road topology and mapped medical facilities for network analysis.",
  },
];

export default function Page() {
  return (
    <>
      <header className="masthead">
        <a className="wordmark" href="/" aria-label="K-SAR home">K-SAR</a>
        <span>Research workspace</span>
        <span className="version">Scaffold · 0.1.0</span>
      </header>
      <main>
        <div className="workspace-heading">
          <p className="location">{studyArea.country} / {studyArea.geographicCrs}</p>
          <h1>{studyArea.name}</h1>
          <p className="introduction">
            Flood observations, surface scenarios and road-network analysis.
            This new repository is ready for the reviewed research data to be imported.
          </p>
        </div>
        <div className="workspace-body">
          <section aria-labelledby="data-heading">
            <div className="section-heading">
              <h2 id="data-heading">Data scope</h2>
              <span>Import pending</span>
            </div>
            <ul className="dataset-list">
              {datasetScope.map((dataset) => (
                <li key={dataset.id}>
                  <div className="dataset-label">
                    <h3>{dataset.name}</h3>
                    <span>{evidenceLabels[dataset.evidence]}</span>
                  </div>
                  <div>
                    <p>{dataset.interpretation}</p>
                    {dataset.referenceGrid && (
                      <p className="grid-reference">
                        Prior research grid: {dataset.referenceGrid.width} × {dataset.referenceGrid.height}
                        {" · "}{dataset.referenceGrid.pixelSizeMeters[0]} m pixels
                      </p>
                    )}
                  </div>
                  <span className="dataset-state">Not imported</span>
                </li>
              ))}
            </ul>
            <p className="availability">
              Maps, measurements and route calculations will appear after their data and
              processing methods have been checked. No analysis is running on this page.
            </p>
          </section>
          <aside aria-labelledby="research-heading">
            <h2 id="research-heading">Research boundaries</h2>
            <dl className="research-notes">
              <div>
                <dt>Observations</dt>
                <dd>Radar values describe the acquisition dates. They do not establish the flood peak.</dd>
              </div>
              <div>
                <dt>Scenarios</dt>
                <dd>Water level and subsidence are model parameters, separate from measured flood depth.</dd>
              </div>
              <div>
                <dt>Routing</dt>
                <dd>Mapped roads and facility locations require validation before operational use.</dd>
              </div>
            </dl>
          </aside>
        </div>
        <footer>
          <span>Project K-SAR · Research prototype</span>
          <span>Data provenance and development history are recorded in the repository.</span>
        </footer>
      </main>
    </>
  );
}

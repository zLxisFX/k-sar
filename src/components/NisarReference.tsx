import type { CatalogFootprint, NisarRecord } from "@/domain/research";

function acquisitionLabel(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

export default function NisarReference({
  records,
  intervalDays,
  footprints,
}: {
  records: NisarRecord[];
  intervalDays: number;
  footprints: CatalogFootprint[];
}) {
  return (
    <section className="nisar-reference" aria-labelledby="nisar-title">
      <div className="section-heading">
        <div>
          <p className="section-kicker">NASA–ISRO NISAR · L-SAR</p>
          <h2 id="nisar-title">Two acquisitions, {intervalDays} days apart</h2>
        </div>
        <span>2026 catalog reference</span>
      </div>
      <div className="browse-pair">
        {records.map((record) => (
          <figure key={record.conceptId} className="browse-scene">
            <figcaption>
              <div>
                <h3>{acquisitionLabel(record.acquisitionStart)}</h3>
                <p>
                  {new Date(record.acquisitionStart)
                    .toISOString()
                    .slice(11, 19)}{" "}
                  UTC · {record.direction.toLowerCase()}
                </p>
              </div>
              <a
                href={`/data/nasa/nisar/${record.browse.path}`}
                target="_blank"
                rel="noreferrer"
              >
                Open image
                <span className="sr-only">
                  {" "}
                  for {acquisitionLabel(record.acquisitionStart)}
                </span>
              </a>
            </figcaption>
            <a
              className="browse-image"
              href={`/data/nasa/nisar/${record.browse.path}`}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open full NISAR browse image for ${acquisitionLabel(record.acquisitionStart)}`}
            >
              <img
                src={`/data/nasa/nisar/${record.browse.path}`}
                width={record.browse.width}
                height={record.browse.height}
                alt={`Provider NISAR L-SAR browse image acquired ${acquisitionLabel(record.acquisitionStart)}. Geographic scene preview, not quantitative backscatter.`}
              />
            </a>
            <div className="scene-metadata">
              <span>
                Track {record.track} / frame {record.frame}
              </span>
              <span>{record.maturity.toLowerCase()} GCOV</span>
            </div>
            <details className="source-detail">
              <summary>Acquisition, footprint and source</summary>
              <p className="granule-id">{record.granuleUr}</p>
              <p>
                Stack {record.stackId} · {record.conceptId}
              </p>
              <p>
                {record.acquisitionStart} to {record.acquisitionEnd}
              </p>
              <table className="footprint-table">
                <caption>Catalog footprint corners · WGS 84</caption>
                <thead>
                  <tr>
                    <th scope="col">Corner</th>
                    <th scope="col">Longitude</th>
                    <th scope="col">Latitude</th>
                  </tr>
                </thead>
                <tbody>
                  {footprints
                    .find((footprint) => footprint.id === record.conceptId)
                    ?.geometry.coordinates[0].slice(0, -1)
                    .map(([lon, lat], corner) => (
                      <tr key={corner}>
                        <th scope="row">{corner + 1}</th>
                        <td>{lon.toFixed(5)}°</td>
                        <td>{lat.toFixed(5)}°</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <p>
                <a href={`/data/nasa/nisar/${record.metadata.path}`} download>
                  Download raw record
                </a>
                {" · "}
                <a
                  href={record.metadata.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  NASA CMR source
                </a>
                {" · "}
                <a
                  href={record.browse.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Provider image
                </a>
              </p>
            </details>
          </figure>
        ))}
      </div>
      <p className="evidence-note">
        The original provider images below retain their full scene extents.
        Select NISAR L-band in the main map to swipe their aligned common-area
        subset and inspect RGB display changes. Alignment uses the provider KML
        geometry and both catalog footprints. Display brightness is not
        calibrated backscatter. These 2026 acquisitions do not observe the July
        2024 Carina event.
      </p>
      <div className="source-links">
        <span>NASA JPL / NASA ASF DAAC · provider-rendered GCOV browse</span>
        <a href="/data/nasa/nisar/footprints.geojson" download>
          Download footprints
        </a>
        <a
          href="/data/nasa/nisar/raw/C3622241360-ASF.umm.json"
          target="_blank"
          rel="noreferrer"
        >
          Collection and data-use terms
        </a>
        <a
          href="/data/nasa/nisar/manifest.json"
          target="_blank"
          rel="noreferrer"
        >
          Provenance and checksums
        </a>
      </div>
    </section>
  );
}

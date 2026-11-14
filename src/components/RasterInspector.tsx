"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { assertAlignedGrids, backscatterChangeDb, decodeRaster, pixelAtWgs84, sampleRasterWgs84 } from "@/domain/raster";
import type { DecodedRaster } from "@/domain/raster";
import { correctedElevation } from "@/domain/elevation";
import type { ReferenceTransect } from "@/domain/research";
import TransectProfile from "./TransectProfile";

type RasterSet = { baseline: DecodedRaster; post: DecodedRaster; dem: DecodedRaster };
type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; rasters: RasterSet };

function valueLabel(value: number | null | undefined, precision = 2) {
  return value == null || !Number.isFinite(value) ? "No data" : value.toFixed(precision);
}

export default function RasterInspector({ transect }: { transect: ReferenceTransect }) {
  const firstIndex = Math.floor(transect.samples.length / 2);
  const firstSample = transect.samples[firstIndex];
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(firstIndex);
  const [coordinate, setCoordinate] = useState({ lon: firstSample.lon, lat: firstSample.lat });
  const [longitude, setLongitude] = useState(firstSample.lon.toFixed(6));
  const [latitude, setLatitude] = useState(firstSample.lat.toFixed(6));
  const [rate, setRate] = useState(-30);
  const [years, setYears] = useState(13);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setLoad({ status: "loading" });
    async function loadRaster(name: string) {
      const response = await fetch(`/data/sentinel-1/${name}.tif`, { signal: controller.signal });
      if (!response.ok) throw new Error(`${name} raster returned HTTP ${response.status}`);
      return decodeRaster(await response.arrayBuffer());
    }
    Promise.all([loadRaster("baseline"), loadRaster("post"), loadRaster("dem")])
      .then(([baseline, post, dem]) => {
        assertAlignedGrids(baseline, post, dem);
        if (current) setLoad({ status: "ready", rasters: { baseline, post, dem } });
      })
      .catch((error: unknown) => {
        if (current) setLoad({ status: "error", message: error instanceof Error ? error.message : "Raster decoding failed" });
      });
    return () => { current = false; controller.abort(); };
  }, [attempt]);

  const rasters = load.status === "ready" ? load.rasters : null;
  const pixel = rasters ? pixelAtWgs84(rasters.baseline, coordinate.lon, coordinate.lat) : null;
  const before = rasters ? sampleRasterWgs84(rasters.baseline, coordinate.lon, coordinate.lat, 0) : null;
  const after = rasters ? sampleRasterWgs84(rasters.post, coordinate.lon, coordinate.lat, 0) : null;
  const elevation = rasters ? sampleRasterWgs84(rasters.dem, coordinate.lon, coordinate.lat, 0) : null;
  const delta = backscatterChangeDb(before, after);
  const adjusted = correctedElevation(elevation, rate, years);
  const displacement = Math.abs(rate) / 1000 * years;
  const selectedSample = activeIndex === null ? null : transect.samples[activeIndex];

  function selectSample(index: number) {
    const sample = transect.samples[index];
    setActiveIndex(index);
    setCoordinate({ lon: sample.lon, lat: sample.lat });
    setLongitude(sample.lon.toFixed(6));
    setLatitude(sample.lat.toFixed(6));
  }

  function inspectCoordinate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const lon = Number(longitude);
    const lat = Number(latitude);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    setCoordinate({ lon, lat });
    setActiveIndex(null);
  }

  return (
    <section className="raster-workspace" aria-labelledby="raster-title">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Sentinel-1 RTC · 2024 event reference</p>
          <h2 id="raster-title">Inspect a pixel and its surface elevation</h2>
        </div>
        <a href="/data/sentinel-1/manifest.json" target="_blank" rel="noreferrer">Data provenance</a>
      </div>
      <div className="raster-body">
        <div className="pixel-inspector">
          <form onSubmit={inspectCoordinate} className="coordinate-form">
            <label>Longitude<input type="number" min="-180" max="180" step="any" value={longitude} onChange={(event) => setLongitude(event.target.value)} required /></label>
            <label>Latitude<input type="number" min="-90" max="90" step="any" value={latitude} onChange={(event) => setLatitude(event.target.value)} required /></label>
            <button type="submit">Inspect</button>
          </form>
          <p className="pixel-location">
            WGS 84 · {coordinate.lon.toFixed(6)}° E, {coordinate.lat.toFixed(6)}° N
            {pixel && ` · nearest pixel: column ${pixel.column}, row ${pixel.row} (zero-based)`}
          </p>
          {load.status === "loading" && <p className="load-state" role="status">Loading and decoding the three local GeoTIFF rasters…</p>}
          {load.status === "error" && <div className="load-state" role="alert"><p>Raster data could not be loaded. {load.message}</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry loading</button></div>}
          {rasters && !pixel && <p className="load-state" role="status">This coordinate is outside the imported raster grid. Choose a transect sample or another coordinate.</p>}
          <dl className="pixel-values" aria-label="Selected raster measurements">
            <div><dt>10 Jul 2024 · VV</dt><dd>{valueLabel(before)} <span>dB</span></dd></div>
            <div><dt>3 Aug 2024 · VV</dt><dd>{valueLabel(after)} <span>dB</span></dd></div>
            <div><dt>VV change</dt><dd>{delta !== null && delta > 0 ? "+" : ""}{valueLabel(delta)} <span>dB</span></dd></div>
            <div><dt>Copernicus DSM</dt><dd>{valueLabel(elevation)} <span>m EGM2008</span></dd></div>
          </dl>
          <p className="evidence-note">Values come from the aligned Float32 rasters: VV is already in dB. This point sample does not establish flood depth.</p>
          {rasters && <p className="grid-caption">{rasters.baseline.width} × {rasters.baseline.height} pixels · {rasters.baseline.pixelSizeMeters[0]} m projected spacing · {rasters.baseline.crs}</p>}
          <details className="source-detail data-licenses">
            <summary>Attribution and data licenses</summary>
            <p>Contains modified Copernicus Sentinel data 2024. RTC processing: Catalyst; distribution: Microsoft Planetary Computer.</p>
            <p>Produced using Copernicus WorldDEM-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.</p>
            <p><a href="/data/NOTICE.txt" target="_blank" rel="noreferrer">Full attribution and reuse notice</a></p>
            <p><a href="/data/licenses/cc-by-4.0.txt" target="_blank" rel="noreferrer">RTC: CC BY 4.0</a>{" · "}<a href="/data/licenses/sentinel-data-legal-notice.pdf" target="_blank" rel="noreferrer">Sentinel legal notice</a></p>
            <p><a href="/data/licenses/copernicus-dem-licenses.pdf#page=22" target="_blank" rel="noreferrer">WorldDEM-30 GLO-30-F license, pages 22–24</a></p>
          </details>
        </div>
        <div className="profile-workspace">
          <div className="profile-heading">
            <h3>Marikina River cross-section</h3>
            <span>{transect.sample_count} samples · {(transect.distance_m / 1000).toFixed(3)} km</span>
          </div>
          <TransectProfile samples={transect.samples} activeIndex={activeIndex} rate={rate} years={years} onSelect={selectSample} />
          <div className="sample-readout" aria-live="polite">
            {selectedSample ? <><span>Sample {(activeIndex ?? 0) + 1} / {transect.sample_count}</span><span>{selectedSample.distance_m.toFixed(0)} m along transect</span><span>DSM {valueLabel(selectedSample.dsm_m)} m EGM2008</span></> : <span>Custom coordinate selected. Choose the profile to return to the transect.</span>}
          </div>
          <div className="scenario-controls">
            <div className="scenario-intro"><h3>Subsidence scenario</h3><p>A uniform parameter adjustment, not a measured displacement field.</p><button className="text-button" type="button" onClick={() => { setRate(-30); setYears(13); }}>Reset parameters</button></div>
            <label>Vertical rate <output>{rate} mm/yr</output><input aria-label="Vertical rate" type="range" min="-50" max="0" step="1" value={rate} onChange={(event) => setRate(Number(event.target.value))} /></label>
            <label>Elapsed time <output>{years} yr</output><input aria-label="Elapsed time" type="range" min="0" max="30" step="1" value={years} onChange={(event) => setYears(Number(event.target.value))} /></label>
          </div>
          <div className="scenario-result"><span>Surface correction <strong>{displacement > 0 ? "−" : ""}{displacement.toFixed(3)} m</strong></span><span>Selected pixel: {valueLabel(elevation)} → <strong>{valueLabel(adjusted)} m EGM2008</strong></span></div>
          <p className="evidence-note">Adjusted surface = DSM − (|vertical rate| / 1,000) × elapsed years. Surface elevation includes objects such as buildings and vegetation; it is not a bare-earth terrain measurement.</p>
        </div>
      </div>
    </section>
  );
}

"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import {
  assertAlignedGrids,
  decodeRaster,
  sampleRasterWgs84,
  backscatterChangeDb,
} from "@/domain/raster";
import { correctedElevation } from "@/domain/elevation";
import { simulateSms } from "@/domain/sms";
import { serializeSession } from "@/domain/session";
import rasterManifest from "@data/sentinel-1/manifest.json";
import networkManifest from "@data/network/manifest.json";
import waterwayProvenance from "@data/network/waterways-provenance.json";
import nisarManifest from "@data/nasa/nisar/manifest.json";
import type { LocalSmsResult } from "@/domain/sms";
import type { StudyArea } from "@/domain/geospatial";
import type {
  ReferenceTransect,
  NisarRecord,
  CatalogFootprint,
} from "@/domain/research";
import type {
  Coordinate,
  RasterSet,
  RouteCatalog,
  RouteResponse,
  ScenarioInputs,
} from "./workspace-types";
import NisarReference from "./NisarReference";
import TransectProfile from "./TransectProfile";
const BasinMap = dynamic(() => import("./BasinMap"), {
  ssr: false,
  loading: () => <p className="map-loading">Loading map renderer…</p>,
});
const DEFAULT_SCENARIO: ScenarioInputs = {
  waterLevelM: 10,
  rateMmYear: -30,
  elapsedYears: 13,
};
const number = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value) ? "No data" : value.toFixed(digits);
type Props = {
  studyArea: StudyArea;
  transect: ReferenceTransect;
  transectHash: string;
  nisarRecords: NisarRecord[];
  nisarInterval: number;
  footprints: CatalogFootprint[];
};
export default function ResearchWorkspace(p: Props) {
  const [rasters, setRasters] = useState<RasterSet | null>(null),
    [dataError, setDataError] = useState(""),
    [loadAttempt, setLoadAttempt] = useState(0),
    [routeAttempt, setRouteAttempt] = useState(0),
    [mapError, setMapError] = useState("");
  const [catalog, setCatalog] = useState<RouteCatalog | null>(null),
    [originId, setOriginId] = useState(""),
    [hospitalId, setHospitalId] = useState("");
  const [parameters, setParameters] = useState(DEFAULT_SCENARIO),
    [scenarioOn, setScenarioOn] = useState(false),
    [receivedRoute, setRoute] = useState<RouteResponse | null>(null),
    [routeStatus, setRouteStatus] = useState<
      "idle" | "loading" | "ready" | "error"
    >("idle"),
    [routeError, setRouteError] = useState("");
  const [radar, setRadar] = useState(true),
    [roads, setRoads] = useState(true),
    [profileOpen, setProfileOpen] = useState(true),
    [activeIndex, setActiveIndex] = useState<number | null>(29);
  const [point, setPoint] = useState<Coordinate>([
    p.transect.samples[29].lon,
    p.transect.samples[29].lat,
  ]);
  const [lonInput, setLonInput] = useState(point[0].toFixed(6)),
    [latInput, setLatInput] = useState(point[1].toFixed(6));
  const [modal, setModal] = useState<"sources" | "sms" | null>(null),
    [smsInput, setSmsInput] = useState("FLOOD Tumana"),
    [smsResult, setSmsResult] = useState<LocalSmsResult | null>(null),
    [exportStatus, setExportStatus] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    requestVersion = useRef(0),
    mapView = useRef({
      center: [121.086, 14.651] as Coordinate,
      zoom: 12.7,
      curtainPercent: 50,
    });
  const origin = catalog?.origins.find((item) => item.id === originId);
  const hospital = catalog?.hospitals.find((item) => item.id === hospitalId);
  const scenario = scenarioOn ? parameters : null;
  const route =
    receivedRoute &&
    origin &&
    receivedRoute.request.hospitalId === hospitalId &&
    JSON.stringify(receivedRoute.request.origin) ===
      JSON.stringify(origin.coordinate) &&
    JSON.stringify(receivedRoute.request.scenario) === JSON.stringify(scenario)
      ? receivedRoute
      : null;
  const calculationPending =
    routeStatus === "loading" || (routeStatus === "ready" && !route);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setDataError("");
    setRouteError("");
    Promise.all(
      ["baseline", "post", "dem"].map(async (name) => {
        const response = await fetch(`/data/sentinel-1/${name}.tif`, {
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(`Raster ${name}: HTTP ${response.status}`);
        return decodeRaster(await response.arrayBuffer());
      }),
    )
      .then(([baseline, post, dem]) => {
        assertAlignedGrids(baseline, post, dem);
        if (current) setRasters({ baseline, post, dem });
      })
      .catch((error) => {
        if (current) setDataError(String(error));
      });
    fetch("/api/route", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`Routing catalog: HTTP ${response.status}`);
        return response.json() as Promise<RouteCatalog>;
      })
      .then((result) => {
        if (current) {
          setCatalog(result);
          setOriginId((currentId) =>
            result.origins.some((item) => item.id === currentId)
              ? currentId
              : (result.origins.find((item) => /tumana/i.test(item.name))?.id ??
                result.origins[0]?.id ??
                ""),
          );
          setHospitalId((currentId) =>
            result.hospitals.some((item) => item.id === currentId)
              ? currentId
              : result.defaultHospitalId,
          );
        }
      })
      .catch((error) => {
        if (current) setRouteError(String(error));
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [loadAttempt]);
  useEffect(() => {
    if (!origin || !hospitalId) return;
    const controller = new AbortController();
    const version = ++requestVersion.current;
    setRoute(null);
    setRouteStatus("loading");
    setRouteError("");
    const timer = setTimeout(() => {
      fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: origin.coordinate,
          hospitalId,
          scenario,
        }),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok)
            throw new Error(`Route calculation: HTTP ${response.status}`);
          return response.json() as Promise<RouteResponse>;
        })
        .then((result) => {
          if (version === requestVersion.current) {
            setRoute(result);
            setRouteStatus("ready");
          }
        })
        .catch((error) => {
          if (
            !controller.signal.aborted &&
            version === requestVersion.current
          ) {
            setRouteError(String(error));
            setRouteStatus("error");
          }
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [origin, hospitalId, scenario, routeAttempt]);
  useEffect(() => {
    if (modal) dialog.current?.showModal();
    else dialog.current?.close();
  }, [modal]);
  function pick(coordinate: Coordinate) {
    setPoint(coordinate);
    setLonInput(coordinate[0].toFixed(6));
    setLatInput(coordinate[1].toFixed(6));
    setActiveIndex(null);
  }
  function sample(index: number) {
    const selected = p.transect.samples[index];
    pick([selected.lon, selected.lat]);
    setActiveIndex(index);
  }
  const before = rasters ? sampleRasterWgs84(rasters.baseline, ...point) : null,
    after = rasters ? sampleRasterWgs84(rasters.post, ...point) : null,
    elevation = rasters ? sampleRasterWgs84(rasters.dem, ...point) : null;
  const delta = backscatterChangeDb(before, after),
    adjusted = correctedElevation(
      elevation,
      parameters.rateMmYear,
      parameters.elapsedYears,
    );
  const result = scenarioOn ? route?.scenarioRoute : route?.baseline;
  function downloadSession() {
    const payload = serializeSession(
      {
        datasets: [
          ...rasterManifest.files.map((file) => ({
            id: `sentinel-1/${file.file}`,
            sha256: file.sha256,
          })),
          ...networkManifest.files.map((file) => ({
            id: `network/${file.path}`,
            sha256: file.sha256,
          })),
          {
            id: `network/${waterwayProvenance.file.path}`,
            sha256: waterwayProvenance.file.sha256,
          },
          { id: "transect/reference.json", sha256: p.transectHash },
          ...nisarManifest.records.flatMap((record) => [
            {
              id: `nasa/nisar/${record.browse.path}`,
              sha256: record.browse.sha256,
            },
            {
              id: `nasa/nisar/${record.metadata.path}`,
              sha256: record.metadata.sha256,
            },
          ]),
          {
            id: `nasa/nisar/${nisarManifest.collection.metadata.path}`,
            sha256: nisarManifest.collection.metadata.sha256,
          },
          {
            id: `nasa/nisar/${nisarManifest.footprints.path}`,
            sha256: nisarManifest.footprints.sha256,
          },
        ],
        view: {
          ...mapView.current,
          selectedCoordinate: point,
          transectIndex: activeIndex,
          layers: { radar, roadNetwork: roads, crossSection: profileOpen },
        },
        surfacePreview: parameters,
        requestedRoute: origin
          ? { origin: origin.coordinate, hospitalId, scenario }
          : null,
        appliedRoute: routeStatus === "ready" ? route : null,
        calculationPending,
      },
      new Date().toISOString(),
    );
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ksar-session.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportStatus("Session downloaded");
  }
  return (
    <div className="instrument">
      <header className="instrument-header">
        <a className="wordmark" href="/">
          K-SAR
        </a>
        <span
          className="basin-name"
          title={`${p.studyArea.country} · ${p.studyArea.geographicCrs}`}
        >
          {p.studyArea.name}
        </span>
        <span className="header-context">Radar, surface & road network</span>
        <nav>
          <button onClick={() => setModal("sources")}>Sources</button>
          <button onClick={() => setModal("sms")}>SMS prototype</button>
          <button onClick={downloadSession}>Export session</button>
        </nav>
      </header>
      <main className="instrument-body">
        <section className="map-column" aria-label="Radar map and transect">
          <div className="map-toolbar">
            <label>
              <input
                type="checkbox"
                checked={radar}
                onChange={(e) => setRadar(e.target.checked)}
              />{" "}
              Radar
            </label>
            <label>
              <input
                type="checkbox"
                checked={roads}
                onChange={(e) => setRoads(e.target.checked)}
              />{" "}
              Road network
            </label>
            <span>Orbit 32 · 30 m projected grid</span>
            <button
              onClick={() => setProfileOpen((value) => !value)}
              aria-expanded={profileOpen}
            >
              Cross-section {profileOpen ? "−" : "+"}
            </button>
          </div>
          <BasinMap
            rasters={rasters}
            route={routeStatus === "ready" ? route : null}
            scenario={scenario}
            radar={radar}
            roads={roads}
            point={point}
            transect={p.transect}
            onPick={pick}
            onError={setMapError}
            onView={(view) => {
              mapView.current = view;
            }}
          />
          <div className="live-readout" aria-live="polite">
            <span>
              {point[0].toFixed(5)}° E · {point[1].toFixed(5)}° N
            </span>
            <span>
              VV{" "}
              <strong>
                {number(before)} → {number(after)} dB
              </strong>
            </span>
            <span>
              ΔVV{" "}
              <strong>
                {delta !== null && delta > 0 ? "+" : ""}
                {number(delta)} dB
              </strong>
            </span>
            <span>
              DSM <strong>{number(elevation)} m EGM2008</strong>
            </span>
          </div>
          {!rasters && (
            <div className="map-status" role="status">
              {dataError ||
                "Loading local calibrated radar and elevation rasters…"}
              {dataError && (
                <button onClick={() => setLoadAttempt((value) => value + 1)}>
                  Retry data
                </button>
              )}
            </div>
          )}
          {mapError && (
            <div className="map-status error">
              Map layer unavailable: {mapError}
            </div>
          )}
          {profileOpen && (
            <section className="profile-strip" aria-label="River cross-section">
              <div className="profile-heading">
                <h2>Marikina River cross-section</h2>
                <span>
                  59 samples · 1.724 km ·{" "}
                  {scenarioOn ? "Scenario applied" : "Surface preview"}
                </span>
                <span>
                  {activeIndex !== null
                    ? `Sample ${activeIndex + 1} · ${p.transect.samples[activeIndex].distance_m.toFixed(0)} m`
                    : "Map coordinate selected"}
                </span>
              </div>
              <TransectProfile
                samples={p.transect.samples}
                activeIndex={activeIndex}
                rate={parameters.rateMmYear}
                years={parameters.elapsedYears}
                onSelect={sample}
              />
            </section>
          )}
        </section>
        <aside className="analysis-panel" aria-label="Analysis controls">
          <section className="route-panel">
            <div className="panel-heading">
              <h1>Hospital route</h1>
              <span>OSM network</span>
            </div>
            <label className="field-label">
              Starting location
              <select
                value={originId}
                onChange={(e) => setOriginId(e.target.value)}
                disabled={!catalog}
              >
                {catalog?.origins.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Medical facility
              <select
                value={hospitalId}
                onChange={(e) => setHospitalId(e.target.value)}
                disabled={!catalog}
              >
                {catalog?.hospitals.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="selected-facility">
              {hospital ? (
                <a href={hospital.sourceUrl} target="_blank" rel="noreferrer">
                  View selected OSM feature
                </a>
              ) : (
                "Loading mapped facilities…"
              )}
            </p>
            <div
              className={`route-summary ${result?.status === "NO_PATH" ? "no-path" : ""}`}
              role="status"
            >
              {calculationPending ? (
                <strong>Calculating route…</strong>
              ) : result ? (
                <>
                  <strong>
                    {result.status === "NETWORK_PATH"
                      ? `${number((result.lengthM ?? 0) / 1000, 3)} km`
                      : result.status === "NO_PATH"
                        ? "No network path"
                        : "No nearby road"}
                  </strong>
                  <span>
                    {scenarioOn
                      ? "Under current scenario"
                      : "Baseline network path"}
                  </span>
                </>
              ) : (
                <strong>
                  {routeError
                    ? "Calculation unavailable"
                    : "Loading road graph…"}
                </strong>
              )}
            </div>
            {routeError && (
              <p className="error">
                {routeError}{" "}
                <button
                  onClick={() =>
                    catalog
                      ? setRouteAttempt((value) => value + 1)
                      : setLoadAttempt((value) => value + 1)
                  }
                >
                  Retry calculation
                </button>
              </p>
            )}
            {route && (
              <dl className="route-comparison">
                <div>
                  <dt>Baseline</dt>
                  <dd>
                    {route.baseline.status === "NETWORK_PATH"
                      ? `${number((route.baseline.lengthM ?? 0) / 1000, 3)} km`
                      : route.baseline.status
                          .replaceAll("_", " ")
                          .toLowerCase()}
                  </dd>
                </div>
                {scenarioOn && (
                  <div>
                    <dt>Scenario</dt>
                    <dd>
                      {route.scenarioRoute?.status === "NETWORK_PATH"
                        ? `${number((route.scenarioRoute.lengthM ?? 0) / 1000, 3)} km`
                        : route.scenarioRoute?.status === "NO_NEARBY_ROAD"
                          ? "No nearby road"
                          : "No path"}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>A* graph search · server</dt>
                  <dd title={result?.timingScope}>
                    {number(result?.solveMs, 3)} ms
                  </dd>
                </div>
                <div>
                  <dt>Endpoint offsets</dt>
                  <dd>
                    {number(result?.snapStartM, 0)} /{" "}
                    {number(result?.snapEndM, 0)} m
                  </dd>
                </div>
              </dl>
            )}
            <p className="panel-note">
              Path to the selected mapped anchor. Road passability, entrances
              and facility capacity are unverified.
            </p>
          </section>
          <section className="scenario-panel">
            <div className="panel-heading">
              <h2>Surface scenario</h2>
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={scenarioOn}
                  onChange={(e) => setScenarioOn(e.target.checked)}
                />{" "}
                Use for routing
              </label>
            </div>
            <p className="panel-note">
              Water level relative to EGM2008, with a uniform subsidence
              adjustment.
            </p>
            <label className="range-label">
              Water level<output>{parameters.waterLevelM.toFixed(1)} m</output>
              <input
                aria-label="Water level"
                type="range"
                min="0"
                max="15"
                step="0.5"
                value={parameters.waterLevelM}
                onChange={(e) =>
                  setParameters({
                    ...parameters,
                    waterLevelM: Number(e.target.value),
                  })
                }
              />
            </label>
            <label className="range-label">
              Vertical rate<output>{parameters.rateMmYear} mm/yr</output>
              <input
                aria-label="Vertical rate"
                type="range"
                min="-50"
                max="0"
                step="1"
                value={parameters.rateMmYear}
                onChange={(e) =>
                  setParameters({
                    ...parameters,
                    rateMmYear: Number(e.target.value),
                  })
                }
              />
            </label>
            <label className="range-label">
              Elapsed time<output>{parameters.elapsedYears} yr</output>
              <input
                aria-label="Elapsed time"
                type="range"
                min="0"
                max="30"
                step="1"
                value={parameters.elapsedYears}
                onChange={(e) =>
                  setParameters({
                    ...parameters,
                    elapsedYears: Number(e.target.value),
                  })
                }
              />
            </label>
            <div className="scenario-note">
              <span>
                Surface lowering{" "}
                <strong>
                  {(
                    (Math.abs(parameters.rateMmYear) / 1000) *
                    parameters.elapsedYears
                  ).toFixed(3)}{" "}
                  m
                </strong>
              </span>
              <button
                className="text-button"
                onClick={() => setParameters(DEFAULT_SCENARIO)}
              >
                Reset
              </button>
            </div>
            <p className="closure-rule">
              Exclude sampled depth <strong>&gt; 0.30 m</strong> and unknown
              elevations.
            </p>
            {route?.scenarioSummary && (
              <p className="panel-note">
                {route.scenarioSummary.closedEdges.toLocaleString()} depth
                closures (+
                {route.scenarioSummary.additionalClosedEdges.toLocaleString()}{" "}
                from lowering) ·{" "}
                {route.scenarioSummary.unknownEdges.toLocaleString()} unknown
                edges
              </p>
            )}
          </section>
          <section className="pixel-panel">
            <div className="panel-heading">
              <h2>Selected raster cell</h2>
              <span>WGS 84</span>
            </div>
            <form
              className="coordinate-form"
              onSubmit={(e) => {
                e.preventDefault();
                pick([Number(lonInput), Number(latInput)]);
              }}
            >
              <label>
                Longitude
                <input
                  aria-label="Longitude"
                  type="number"
                  step="any"
                  min="-180"
                  max="180"
                  value={lonInput}
                  required
                  onChange={(e) => setLonInput(e.target.value)}
                />
              </label>
              <label>
                Latitude
                <input
                  aria-label="Latitude"
                  type="number"
                  step="any"
                  min="-90"
                  max="90"
                  value={latInput}
                  required
                  onChange={(e) => setLatInput(e.target.value)}
                />
              </label>
              <button>Inspect</button>
            </form>
            <dl className="pixel-values">
              <div>
                <dt>10 Jul · γ⁰ VV</dt>
                <dd>{number(before)} dB</dd>
              </div>
              <div>
                <dt>3 Aug · γ⁰ VV</dt>
                <dd>{number(after)} dB</dd>
              </div>
              <div>
                <dt>VV change</dt>
                <dd>
                  {delta !== null && delta > 0 ? "+" : ""}
                  {number(delta)} dB
                </dd>
              </div>
              <div>
                <dt>{scenarioOn ? "DSM / adjusted" : "DSM / preview"}</dt>
                <dd>
                  {number(elevation)} / {number(adjusted)} m
                </dd>
              </div>
            </dl>
            <p className="panel-note">
              Surface heights: EGM2008. Radar change is not a flood-depth
              measurement.
            </p>
          </section>
          <div className="workspace-footer">
            <span>
              {catalog
                ? `${catalog.counts.nodes.toLocaleString()} nodes · ${catalog.counts.directedEdges.toLocaleString()} directed edges`
                : "Network catalog pending"}
            </span>
            <p role="status">{exportStatus}</p>
            <a href="/data/NOTICE.txt" target="_blank" rel="noreferrer">
              Data attribution and licenses
            </a>{" "}
            ·{" "}
            <a href="/data/network/NOTICE.txt" target="_blank" rel="noreferrer">
              Road data
            </a>
          </div>
        </aside>
      </main>
      <dialog
        ref={dialog}
        aria-labelledby="workspace-dialog-title"
        onCancel={() => setModal(null)}
        onClose={() => setModal(null)}
        className={modal === "sms" ? "sms-dialog" : "sources-dialog"}
      >
        <header className="dialog-header">
          <h2 id="workspace-dialog-title">
            {modal === "sources"
              ? "Source observations"
              : "SMS request prototype"}
          </h2>
          <button onClick={() => setModal(null)}>Close</button>
        </header>
        {modal === "sources" && (
          <>
            <NisarReference
              records={p.nisarRecords}
              intervalDays={p.nisarInterval}
              footprints={p.footprints}
            />
            <section className="source-baseline">
              <h3>Sentinel-1 event reference · 2024</h3>
              <p>
                10 July and 3 August RTC observations share an aligned 854 × 998
                grid. Their acquisition dates do not establish the July flood
                peak. Scenario water level and subsidence are separate
                assumptions.
              </p>
              <a
                href="/data/sentinel-1/manifest.json"
                target="_blank"
                rel="noreferrer"
              >
                Raster processing and sources
              </a>{" "}
              ·{" "}
              <a href="/data/NOTICE.txt" target="_blank" rel="noreferrer">
                Attribution and license notice
              </a>
            </section>
          </>
        )}
        {modal === "sms" && (
          <>
            <p>
              Enter a triage category and location to inspect a local GSM-7
              response.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSmsResult(simulateSms(smsInput));
              }}
            >
              <label className="field-label">
                Request
                <input
                  value={smsInput}
                  onChange={(e) => {
                    setSmsInput(e.target.value);
                    setSmsResult(null);
                  }}
                  placeholder="FLOOD Tumana"
                />
              </label>
              <button type="submit">Simulate response</button>
            </form>
            {smsResult?.accepted ? (
              <div className="sms-result">
                <p>{smsResult.reply}</p>
                <span>
                  {smsResult.characters} characters · {smsResult.septets} GSM-7
                  septets
                </span>
              </div>
            ) : smsResult ? (
              <p role="alert" className="error">
                {smsResult.error}
              </p>
            ) : null}
            <p className="panel-note">
              Local simulator. No SMS is transmitted and no assistance is
              dispatched.
            </p>
          </>
        )}
      </dialog>
    </div>
  );
}

"use client";

import { useState } from "react";
import type { BackscatterPair, ChangeDistribution, NisarPolarization, NisarSciencePair, NisarScienceSample } from "@/domain/nisar-science";
import type { ReferenceTransect } from "@/domain/research";
import type { RasterSet } from "./workspace-types";
import RadarProfile from "./RadarProfile";

const db = (value: number | null, signed = false) => value === null ? "—" : `${signed && value > 0 ? "+" : ""}${value.toFixed(2)}`;

export function BackscatterTable({ sentinel, nisar, elevation }: {
  sentinel: { VV: BackscatterPair; VH: BackscatterPair };
  nisar: NisarScienceSample;
  elevation: number | null;
}) {
  const row = (name: string, pair: BackscatterPair) => <tr key={name}><th scope="row">{name}</th><td>{db(pair.before)}</td><td>{db(pair.after)}</td><td>{db(pair.delta, true)}</td></tr>;
  return <div className="backscatter-values">
    <table aria-label="Calibrated backscatter at selected coordinate">
      <tbody>
        <tr className="sensor-dates"><th scope="col">Sentinel-1 · 2024</th><th scope="col">10 Jul</th><th scope="col">3 Aug</th><th scope="col">Δ dB</th></tr>
        {row("C-band VV", sentinel.VV)}{row("C-band VH", sentinel.VH)}
        <tr className="sensor-dates"><th scope="col">NISAR · 2026</th><th scope="col">21 Oct</th><th scope="col">2 Nov</th><th scope="col">Δ dB</th></tr>
        {row("L-band HH", nisar.HH)}{row("L-band HV", nisar.HV)}
      </tbody>
    </table>
    <p className="science-dsm">Copernicus DSM <strong>{elevation === null ? "No data" : `${elevation.toFixed(2)} m EGM2008`}</strong></p>
  </div>;
}

export default function NisarScienceAnalysis({ sentinel, nisar, elevation, science, rasters, transect, activeIndex, onSelect, polarization, distribution }: {
  sentinel: { VV: BackscatterPair; VH: BackscatterPair };
  nisar: NisarScienceSample;
  elevation: number | null;
  science: NisarSciencePair | null;
  rasters: RasterSet | null;
  transect: ReferenceTransect;
  activeIndex: number | null;
  onSelect: (index: number) => void;
  polarization: NisarPolarization;
  distribution: ChangeDistribution;
}) {
  const [view, setView] = useState<"profile" | "distribution">("distribution");
  const { edges, counts } = distribution.histogram;
  const peak = Math.max(1, ...counts);
  const low = edges[0], high = edges.at(-1)!;
  const zero = 34 + 472 * -low / (high - low);
  return <section className="science-analysis" aria-label="Calibrated multi-frequency radar analysis">
    <div className="science-heading">
      <div><h2>Calibrated backscatter · γ⁰ / dB</h2><p>{activeIndex === null ? "Map coordinate" : `Transect sample ${activeIndex + 1} · ${transect.samples[activeIndex].distance_m.toFixed(0)} m from A`} · common 30 m projected grid</p></div>
      <div className="nisar-display-buttons" aria-label="Radar analysis view">
        <button aria-pressed={view === "profile"} onClick={() => setView("profile")}>A–B radar profile</button>
        <button aria-pressed={view === "distribution"} onClick={() => setView("distribution")}>12-day distribution</button>
      </div>
    </div>
    <div className="science-analysis-grid">
      <BackscatterTable sentinel={sentinel} nisar={nisar} elevation={elevation} />
      <div className="science-chart">
        <h3>{view === "profile" ? `Marikina River · 59 samples · γ⁰ / dB` : `NISAR ${polarization} · 2 Nov minus 21 Oct 2026`}</h3>
        {view === "profile" ? <RadarProfile transect={transect} rasters={rasters} science={science} polarization={polarization} activeIndex={activeIndex} onSelect={onSelect} /> : <>
          <svg viewBox="0 0 512 133" className="science-histogram" role="img" aria-label={`Distribution of calibrated ${polarization} backscatter change across ${distribution.validPixels} common cells`}>
            <title>All valid common-cell calibrated differences; no histogram clipping</title>
            {counts.map((count, index) => <rect key={index} x={34 + 472 * (edges[index] - low) / (high - low)} y={108 - 98 * count / peak} width={Math.max(.5, 472 * (edges[index + 1] - edges[index]) / (high - low) - .5)} height={98 * count / peak} fill={edges[index + 1] <= 0 ? "#246f78" : "#a96234"}><title>{`${edges[index].toFixed(2)} to ${edges[index + 1].toFixed(2)} dB: ${count.toLocaleString("en-US")} cells`}</title></rect>)}
            <line x1={zero} x2={zero} y1="5" y2="109" stroke="#61756d" strokeDasharray="3 3" />
            <text x="34" y="128">{low.toFixed(1)}</text><text x={zero} y="128" textAnchor="middle">0</text><text x="506" y="128" textAnchor="end">+{high.toFixed(1)} dB</text>
          </svg>
          <p className="science-distribution-summary">{distribution.validPixels.toLocaleString()} common cells · median {db(distribution.median, true)} dB · mean {db(distribution.mean, true)} dB</p>
        </>}
      </div>
    </div>
    <p className="science-scope">C-band VV/VH and L-band HH/HV have different dates, polarizations and viewing geometry. Compare change within each pair; radar intensity is not water depth. <a href="/data/nasa/nisar/science/manifest.json" target="_blank" rel="noreferrer">HDF5 sources, masks and processing</a></p>
  </section>;
}

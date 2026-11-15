"use client";

import { useMemo } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { sampleRasterWgs84 } from "@/domain/raster";
import { sampleScience } from "@/domain/nisar-science";
import type { NisarPolarization, NisarSciencePair } from "@/domain/nisar-science";
import type { ReferenceTransect } from "@/domain/research";
import type { RasterSet } from "./workspace-types";

export default function RadarProfile({ transect, rasters, science, polarization, activeIndex, onSelect }: {
  transect: ReferenceTransect;
  rasters: RasterSet | null;
  science: NisarSciencePair | null;
  polarization: NisarPolarization;
  activeIndex: number | null;
  onSelect: (index: number) => void;
}) {
  const rows = useMemo(() => transect.samples.map(point => {
    const nisar = sampleScience(science, point.lon, point.lat)[polarization];
    return [
      rasters ? sampleRasterWgs84(rasters.baseline, point.lon, point.lat) : null,
      rasters ? sampleRasterWgs84(rasters.post, point.lon, point.lat) : null,
      nisar.before, nisar.after,
    ];
  }), [transect, rasters, science, polarization]);
  const values = rows.flat().filter((value): value is number => value !== null && Number.isFinite(value));
  const low = Math.floor(Math.min(-5, ...values) / 5) * 5;
  const high = Math.ceil(Math.max(0, ...values) / 5) * 5;
  const length = transect.distance_m;
  const x = (index: number) => 34 + transect.samples[index].distance_m / length * 472;
  const y = (value: number) => 8 + (high - value) / (high - low) * 100;
  function path(series: number) {
    let connected = false;
    return rows.map((row, index) => {
      const value = row[series];
      if (value === null) { connected = false; return ""; }
      const command = connected ? "L" : "M";
      connected = true;
      return `${command}${x(index).toFixed(2)},${y(value).toFixed(2)}`;
    }).join(" ");
  }
  function inspect(event: PointerEvent<SVGSVGElement>) {
    const transform = event.currentTarget.getScreenCTM();
    if (!transform) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse());
    const distance = Math.max(0, Math.min(length, (point.x - 34) / 472 * length));
    let nearest = 0;
    for (let index = 1; index < transect.samples.length; index++) {
      if (Math.abs(transect.samples[index].distance_m - distance) < Math.abs(transect.samples[nearest].distance_m - distance)) nearest = index;
    }
    onSelect(nearest);
  }
  function keyboard(event: KeyboardEvent<SVGSVGElement>) {
    const selected = activeIndex ?? 0;
    const next = event.key === "Home" ? 0 : event.key === "End" ? 58 : event.key === "ArrowRight" ? Math.min(58, selected + 1) : event.key === "ArrowLeft" ? Math.max(0, selected - 1) : null;
    if (next !== null) { event.preventDefault(); onSelect(next); }
  }
  const colors = ["#73827d", "#73827d", "#1c6875", "#b06332"];
  return <div className="radar-profile">
    <svg viewBox="0 0 512 133" role="slider" tabIndex={0} aria-label="Inspect radar transect sample" aria-valuemin={1} aria-valuemax={59} aria-valuenow={(activeIndex ?? 0) + 1}
      onPointerDown={inspect} onPointerMove={event => { if (event.pointerType === "mouse" || event.buttons === 1) inspect(event); }} onKeyDown={keyboard}>
      <title>Calibrated radar samples along Marikina River cross-section A–B</title>
      {[low, (low + high) / 2, high].map(tick => <g key={tick}><line x1="34" x2="506" y1={y(tick)} y2={y(tick)} className="chart-rule" /><text x="28" y={y(tick) + 3} textAnchor="end">{tick}</text></g>)}
      {colors.map((color, index) => <path key={index} d={path(index)} fill="none" stroke={color} strokeWidth={index < 2 ? 1 : 1.8} strokeDasharray={index === 1 ? "4 3" : undefined} />)}
      {activeIndex !== null && <line x1={x(activeIndex)} x2={x(activeIndex)} y1="5" y2="110" className="profile-crosshair" />}
      <text x="34" y="128">A · 0 km</text><text x="506" y="128" textAnchor="end">B · 1.724 km</text>
    </svg>
    <div className="radar-profile-legend"><span>C VV · 10 Jul / 3 Aug 2024</span><span>L {polarization} · 21 Oct / 2 Nov 2026</span></div>
  </div>;
}

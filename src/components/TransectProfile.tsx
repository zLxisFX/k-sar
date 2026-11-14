"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { TransectSample } from "@/domain/research";
import { correctedElevation } from "@/domain/elevation";

const MARGIN = { left: 48, right: 18, top: 22, bottom: 32 };

export default function TransectProfile({
  samples,
  activeIndex,
  rate,
  years,
  onSelect,
}: {
  samples: TransectSample[];
  activeIndex: number | null;
  rate: number;
  years: number;
  onSelect: (index: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const helpId = useId();
  const [size, setSize] = useState({ width: 920, height: 180 });
  useEffect(() => {
    const element = svgRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const WIDTH = size.width;
  const HEIGHT = size.height;
  const valid = samples.flatMap((sample) => {
    const adjusted = correctedElevation(sample.dsm_m, rate, years);
    return sample.dsm_m === null || adjusted === null
      ? []
      : [sample.dsm_m, adjusted];
  });
  if (samples.length === 0 || valid.length === 0)
    return <p>Transect elevations are unavailable.</p>;

  const lastDistance = samples[samples.length - 1].distance_m || 1;
  const floor = Math.floor(Math.min(...valid)) - 1;
  const ceiling = Math.ceil(Math.max(...valid)) + 1;
  const x = (distance: number) =>
    MARGIN.left +
    (distance / lastDistance) * (WIDTH - MARGIN.left - MARGIN.right);
  const y = (elevation: number) =>
    MARGIN.top +
    (1 - (elevation - floor) / (ceiling - floor)) *
      (HEIGHT - MARGIN.top - MARGIN.bottom);
  const path = (adjusted: boolean) => {
    let connected = false;
    return samples
      .map((sample) => {
        const elevation = adjusted
          ? correctedElevation(sample.dsm_m, rate, years)
          : sample.dsm_m;
        if (elevation === null || !Number.isFinite(elevation)) {
          connected = false;
          return "";
        }
        const command = connected ? "L" : "M";
        connected = true;
        return `${command}${x(sample.distance_m).toFixed(2)},${y(elevation).toFixed(2)}`;
      })
      .join(" ");
  };
  const selected = activeIndex === null ? null : (samples[activeIndex] ?? null);
  const ticks = [floor, (floor + ceiling) / 2, ceiling];

  function inspect(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const distance = Math.max(
      0,
      Math.min(
        lastDistance,
        ((localX - MARGIN.left) / (WIDTH - MARGIN.left - MARGIN.right)) *
          lastDistance,
      ),
    );
    let closest = 0;
    for (let index = 1; index < samples.length; index++) {
      if (
        Math.abs(samples[index].distance_m - distance) <
        Math.abs(samples[closest].distance_m - distance)
      )
        closest = index;
    }
    onSelect(closest);
  }

  function keyInspect(event: KeyboardEvent<SVGSVGElement>) {
    const index = activeIndex ?? 0;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? samples.length - 1
          : event.key === "ArrowRight" || event.key === "ArrowUp"
            ? Math.min(samples.length - 1, index + 1)
            : event.key === "ArrowLeft" || event.key === "ArrowDown"
              ? Math.max(0, index - 1)
              : null;
    if (next !== null) {
      event.preventDefault();
      onSelect(next);
    }
  }

  return (
    <div className="transect-chart">
      <div className="chart-legend">
        <span className="original-line">DSM surface</span>
        <span className="adjusted-line">Scenario-adjusted surface</span>
        <span>Elevation / m EGM2008</span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="slider"
        tabIndex={0}
        aria-label="Inspect transect sample"
        aria-describedby={helpId}
        aria-valuemin={1}
        aria-valuemax={samples.length}
        aria-valuenow={(activeIndex ?? 0) + 1}
        aria-valuetext={
          selected
            ? `Sample ${(activeIndex ?? 0) + 1}, ${selected.distance_m.toFixed(0)} metres along transect, ${selected.dsm_m === null ? "no elevation data" : `${selected.dsm_m.toFixed(2)} metres EGM2008 DSM elevation`}`
            : "Choose a transect sample"
        }
        onPointerDown={inspect}
        onPointerMove={(event) => {
          if (event.pointerType === "mouse" || event.buttons === 1)
            inspect(event);
        }}
        onKeyDown={keyInspect}
      >
        <title>Marikina River cross-section surface profile</title>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={MARGIN.left}
              x2={WIDTH - MARGIN.right}
              y1={y(tick)}
              y2={y(tick)}
              className="chart-rule"
            />
            <text x={MARGIN.left - 9} y={y(tick) + 4} textAnchor="end">
              {tick.toFixed(Number.isInteger(tick) ? 0 : 1)}
            </text>
          </g>
        ))}
        <path d={path(false)} className="profile-original" />
        <path d={path(true)} className="profile-adjusted" />
        {selected && (
          <line
            x1={x(selected.distance_m)}
            x2={x(selected.distance_m)}
            y1={MARGIN.top}
            y2={HEIGHT - MARGIN.bottom}
            className="profile-crosshair"
          />
        )}
        {[0, lastDistance / 2, lastDistance].map((distance) => (
          <text
            key={distance}
            x={x(distance)}
            y={HEIGHT - 8}
            textAnchor={
              distance === 0
                ? "start"
                : distance === lastDistance
                  ? "end"
                  : "middle"
            }
          >
            {(distance / 1000).toFixed(2)} km
          </text>
        ))}
      </svg>
      <p className="sr-only" id={helpId}>
        Hover or tap a sample. Arrow keys move one sample; Home and End select
        the endpoints.
      </p>
    </div>
  );
}

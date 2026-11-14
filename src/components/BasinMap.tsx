"use client";
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type {
  Map as MapInstance,
  GeoJSONSource,
  ImageSource,
  StyleSpecification,
} from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import type {
  Coordinate,
  RasterSet,
  RouteResponse,
  ScenarioInputs,
} from "./workspace-types";
import type { ReferenceTransect } from "@/domain/research";
import type { DecodedRaster } from "@/domain/raster";
import rasterManifest from "@data/sentinel-1/manifest.json";

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
type MapCoordinate = [number, number];
const rasterCorners = rasterManifest.grid.image_coordinates.map(
  ([lon, lat]) => [lon, lat],
) as [MapCoordinate, MapCoordinate, MapCoordinate, MapCoordinate];
function rasterImage(raster: DecodedRaster, scenario?: ScenarioInputs) {
  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering unavailable");
  const image = context.createImageData(raster.width, raster.height);
  for (let index = 0; index < raster.bands[0].length; index++) {
    const value = raster.bands[0][index];
    if (!Number.isFinite(value)) continue;
    const offset = index * 4;
    if (scenario) {
      const depth =
        scenario.waterLevelM -
        (value -
          (Math.abs(scenario.rateMmYear) / 1000) * scenario.elapsedYears);
      if (depth <= 0) continue;
      image.data[offset] = 40;
      image.data[offset + 1] = 130;
      image.data[offset + 2] = 159;
      image.data[offset + 3] = Math.min(180, 70 + depth * 15);
    } else {
      const grey = Math.round(
        Math.max(0, Math.min(1, (value + 25) / 30)) * 255,
      );
      image.data[offset] = grey;
      image.data[offset + 1] = grey;
      image.data[offset + 2] = grey;
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}
function mapStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      base: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution:
          '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>',
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#e9ede3" },
      },
      {
        id: "base",
        type: "raster",
        source: "base",
        paint: { "raster-saturation": -1, "raster-opacity": 0.55 },
      },
    ],
  };
}
type Props = {
  rasters: RasterSet | null;
  route: RouteResponse | null;
  scenario: ScenarioInputs | null;
  radar: boolean;
  roads: boolean;
  point: Coordinate;
  transect: ReferenceTransect;
  onPick: (point: Coordinate) => void;
  onError: (message: string) => void;
  onView: (view: {
    center: Coordinate;
    zoom: number;
    curtainPercent: number;
  }) => void;
};
export default function BasinMap(p: Props) {
  const lower = useRef<HTMLDivElement>(null),
    upper = useRef<HTMLDivElement>(null),
    maps = useRef<MapInstance[]>([]),
    latest = useRef(p);
  const [ready, setReady] = useState(false),
    [curtain, setCurtain] = useState(50);
  latest.current = p;
  const curtainRef = useRef(curtain);
  curtainRef.current = curtain;
  useEffect(() => {
    if (!lower.current || !upper.current) return;
    maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
    const placeholder = document.createElement("canvas");
    placeholder.width = 1;
    placeholder.height = 1;
    const transparent = placeholder.toDataURL("image/png");
    const primary = new maplibregl.Map({
      container: lower.current,
      style: mapStyle(),
      center: [121.086, 14.651],
      zoom: 12.7,
      attributionControl: { compact: true },
    });
    const comparison = new maplibregl.Map({
      container: upper.current,
      style: mapStyle(),
      center: [121.086, 14.651],
      zoom: 12.7,
      interactive: false,
      attributionControl: false,
    });
    maps.current = [primary, comparison];
    let mounted = true;
    let loaded = 0;
    const sync = () => {
      comparison.jumpTo({
        center: primary.getCenter(),
        zoom: primary.getZoom(),
        bearing: primary.getBearing(),
        pitch: primary.getPitch(),
      });
      const center = primary.getCenter();
      latest.current.onView({
        center: [center.lng, center.lat],
        zoom: primary.getZoom(),
        curtainPercent: curtainRef.current,
      });
    };
    primary.on("move", sync);
    primary.on("click", (e) =>
      latest.current.onPick([e.lngLat.lng, e.lngLat.lat]),
    );
    primary.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "bottom-left",
    );
    primary.addControl(
      new maplibregl.ScaleControl({ unit: "metric" }),
      "bottom-left",
    );
    for (const map of maps.current) {
      map.on("error", (event) => {
        if (mounted) latest.current.onError(event.error.message);
      });
      map.on("load", () => {
        map.addSource("radar", {
          type: "image",
          url: transparent,
          coordinates: rasterCorners,
        });
        map.addLayer({
          id: "radar",
          type: "raster",
          source: "radar",
          layout: { visibility: "none" },
          paint: { "raster-opacity": 0.8, "raster-fade-duration": 0 },
        });
        map.addSource("inundation", {
          type: "image",
          url: transparent,
          coordinates: rasterCorners,
        });
        map.addLayer({
          id: "inundation",
          type: "raster",
          source: "inundation",
          layout: { visibility: "none" },
          paint: { "raster-fade-duration": 0, "raster-opacity": 0.8 },
        });
        map.addSource("roads", {
          type: "geojson",
          data: "/data/network/roads-display.geojson",
        });
        map.addLayer({
          id: "roads",
          type: "line",
          source: "roads",
          paint: {
            "line-color": "#5e6e60",
            "line-opacity": 0.4,
            "line-width": 0.65,
          },
        });
        map.addSource("hospitals", {
          type: "geojson",
          data: "/data/network/hospitals.geojson",
        });
        map.addSource("waterways", {
          type: "geojson",
          data: "/data/network/waterways.geojson",
        });
        map.addLayer({
          id: "waterways",
          type: "line",
          source: "waterways",
          filter: ["in", ["get", "kind"], ["literal", ["river", "canal"]]],
          paint: {
            "line-color": "#5e8f9b",
            "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 14, 2],
            "line-opacity": 0.85,
          },
        });
        map.addLayer({
          id: "hospitals",
          type: "circle",
          source: "hospitals",
          paint: {
            "circle-radius": 3,
            "circle-color": "#f7f5e9",
            "circle-stroke-color": "#715344",
            "circle-stroke-width": 1,
          },
        });
        map.addSource("closures", { type: "geojson", data: EMPTY });
        map.addLayer({
          id: "closures",
          type: "line",
          source: "closures",
          paint: {
            "line-color": "#bb6741",
            "line-width": 1.5,
            "line-opacity": 0.7,
          },
        });
        map.addSource("routes", { type: "geojson", data: EMPTY });
        map.addLayer({
          id: "route-halo",
          type: "line",
          source: "routes",
          paint: { "line-color": "#fffef2", "line-width": 6 },
        });
        map.addLayer({
          id: "route",
          type: "line",
          source: "routes",
          paint: {
            "line-color": [
              "match",
              ["get", "routeKind"],
              "scenario",
              "#a54e27",
              "#175f73",
            ],
            "line-width": 3,
          },
        });
        map.addSource("anchors", { type: "geojson", data: EMPTY });
        map.addLayer({
          id: "anchors",
          type: "circle",
          source: "anchors",
          paint: {
            "circle-radius": 5,
            "circle-color": [
              "match",
              ["get", "kind"],
              "origin",
              "#175f73",
              "#fffef2",
            ],
            "circle-stroke-color": "#175f73",
            "circle-stroke-width": 2,
          },
        });
        map.addSource("transect", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: p.transect.samples.map((s) => [s.lon, s.lat]),
            },
          },
        });
        map.addLayer({
          id: "transect",
          type: "line",
          source: "transect",
          paint: {
            "line-color": "#292c28",
            "line-width": 2,
            "line-dasharray": [3, 2],
          },
        });
        map.addSource("point", { type: "geojson", data: EMPTY });
        map.addLayer({
          id: "point-halo",
          type: "circle",
          source: "point",
          paint: {
            "circle-radius": 7,
            "circle-color": "#fff",
            "circle-opacity": 0.9,
          },
        });
        map.addLayer({
          id: "point",
          type: "circle",
          source: "point",
          paint: { "circle-radius": 3, "circle-color": "#23362c" },
        });
        if (++loaded === 2 && mounted) setReady(true);
      });
    }
    const observer = new ResizeObserver(() => {
      primary.resize();
      comparison.resize();
    });
    observer.observe(lower.current);
    return () => {
      mounted = false;
      observer.disconnect();
      primary.off("move", sync);
      maps.current = [];
      primary.remove();
      comparison.remove();
    };
  }, [p.transect]);
  useEffect(() => {
    if (!ready || !p.rasters) return;
    const images = [
      rasterImage(p.rasters.post),
      rasterImage(p.rasters.baseline),
    ];
    maps.current.forEach((map, index) => {
      (map.getSource("radar") as ImageSource).updateImage({
        url: images[index],
        coordinates: rasterCorners,
      });
    });
  }, [ready, p.rasters]);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    let current = true;
    const markers: maplibregl.Marker[] = [];
    fetch("/data/network/waterways.geojson", { signal: controller.signal })
      .then((response) => response.json())
      .then((collection: FeatureCollection) => {
        if (!current) return;
        const vertices = collection.features
          .filter(
            (feature) =>
              feature.properties?.name === "Marikina River" &&
              feature.geometry.type === "LineString",
          )
          .flatMap((feature) =>
            feature.geometry.type === "LineString"
              ? feature.geometry.coordinates
              : [],
          );
        const center =
          p.transect.samples[Math.floor(p.transect.samples.length / 2)];
        const vertex = vertices.reduce<number[] | null>(
          (nearest, point) =>
            !nearest ||
            Math.hypot(point[0] - center.lon, point[1] - center.lat) <
              Math.hypot(nearest[0] - center.lon, nearest[1] - center.lat)
              ? point
              : nearest,
          null,
        );
        if (vertex)
          for (const map of maps.current) {
            const label = document.createElement("span");
            label.className = "river-label";
            label.textContent = "Marikina River";
            markers.push(
              new maplibregl.Marker({
                element: label,
                anchor: "left",
                offset: [12, -12],
              })
                .setLngLat([vertex[0], vertex[1]])
                .addTo(map),
            );
          }
      })
      .catch((error) => {
        if (current) latest.current.onError(String(error));
      });
    return () => {
      current = false;
      controller.abort();
      markers.forEach((marker) => marker.remove());
    };
  }, [ready, p.transect]);
  useEffect(() => {
    if (!ready) return;
    maps.current.forEach((map) => {
      map.setLayoutProperty(
        "radar",
        "visibility",
        p.radar && p.rasters ? "visible" : "none",
      );
      map.setLayoutProperty(
        "roads",
        "visibility",
        p.roads ? "visible" : "none",
      );
    });
  }, [ready, p.radar, p.roads, p.rasters]);
  useEffect(() => {
    if (!ready || !p.rasters) return;
    const url = p.scenario ? rasterImage(p.rasters.dem, p.scenario) : null;
    maps.current.forEach((map) => {
      if (url)
        (map.getSource("inundation") as ImageSource).updateImage({
          url,
          coordinates: rasterCorners,
        });
      map.setLayoutProperty(
        "inundation",
        "visibility",
        url ? "visible" : "none",
      );
    });
  }, [ready, p.rasters, p.scenario]);
  useEffect(() => {
    if (!ready) return;
    const features: FeatureCollection["features"] = [];
    for (const [kind, result] of [
      ["baseline", p.route?.baseline],
      ["scenario", p.route?.scenarioRoute],
    ] as const) {
      if (result?.feature)
        features.push({
          type: "Feature",
          properties: { routeKind: kind },
          geometry: {
            type: "LineString",
            coordinates: result.feature.geometry.coordinates.map(
              (coordinate) => [...coordinate],
            ),
          },
        });
    }
    const closures: FeatureCollection = {
      type: "FeatureCollection",
      features: (p.route?.scenarioSummary?.closures.features ?? []).map(
        (feature) => ({
          ...feature,
          geometry: {
            type: "MultiLineString",
            coordinates: feature.geometry.coordinates.map((line) =>
              line.map((coordinate) => [...coordinate]),
            ),
          },
        }),
      ),
    };
    maps.current.forEach((map) => {
      (map.getSource("routes") as GeoJSONSource).setData({
        type: "FeatureCollection",
        features,
      });
      (map.getSource("closures") as GeoJSONSource).setData(closures);
    });
  }, [ready, p.route]);
  useEffect(() => {
    if (!ready) return;
    maps.current.forEach((map) =>
      (map.getSource("point") as GeoJSONSource).setData({
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [...p.point] },
      }),
    );
  }, [ready, p.point]);
  useEffect(() => {
    if (!ready) return;
    const data: FeatureCollection = p.route
      ? {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { kind: "origin" },
              geometry: {
                type: "Point",
                coordinates: [...p.route.request.origin],
              },
            },
            {
              type: "Feature",
              properties: { kind: "hospital" },
              geometry: {
                type: "Point",
                coordinates: [...p.route.destination.coordinate],
              },
            },
          ],
        }
      : EMPTY;
    maps.current.forEach((map) =>
      (map.getSource("anchors") as GeoJSONSource).setData(data),
    );
  }, [ready, p.route]);
  useEffect(() => {
    const map = maps.current[0];
    if (!map) return;
    const center = map.getCenter();
    latest.current.onView({
      center: [center.lng, center.lat],
      zoom: map.getZoom(),
      curtainPercent: curtain,
    });
  }, [ready, curtain]);
  function fitRoute() {
    const coordinates =
      p.route?.scenarioRoute?.feature?.geometry.coordinates ??
      p.route?.baseline.feature?.geometry.coordinates;
    if (!coordinates?.length) return;
    const bounds = new maplibregl.LngLatBounds();
    coordinates.forEach((coordinate) =>
      bounds.extend([coordinate[0], coordinate[1]]),
    );
    maps.current[0]?.fitBounds(bounds, {
      padding: 65,
      duration: 350,
      maxZoom: 14.5,
    });
  }
  return (
    <div className="map-frame" data-map-ready={ready}>
      <div ref={lower} className="map-canvas" />
      <div
        ref={upper}
        className="map-canvas comparison-map"
        style={{ clipPath: `inset(0 ${100 - curtain}% 0 0)` }}
      />
      {p.radar && (
        <>
          <div className="map-date before">
            10 Jul 2024 <span>Sentinel-1 VV</span>
          </div>
          <div className="map-date after">
            3 Aug 2024 <span>Sentinel-1 VV</span>
          </div>
          <div className="curtain-line" style={{ left: `${curtain}%` }} />
          <label className="curtain-control">
            Compare radar passes
            <input
              type="range"
              min="0"
              max="100"
              value={curtain}
              aria-label="Radar comparison position"
              onChange={(e) => setCurtain(Number(e.target.value))}
            />
            <output>{curtain}%</output>
          </label>
        </>
      )}
      <div className="map-actions">
        <button
          onClick={() =>
            maps.current[0]?.fitBounds(
              [
                [121.045, 14.59],
                [121.145, 14.715],
              ],
              { duration: 350 },
            )
          }
        >
          Basin extent
        </button>
        <button onClick={fitRoute} disabled={!p.route?.baseline.feature}>
          Fit route
        </button>
      </div>
      <div className="map-legend">
        {p.radar && (
          <>
            <span>γ⁰ VV / dB</span>
            <div className="radar-ramp" />
            <span>−25</span>
            <span>+5</span>
          </>
        )}
        {p.route && (
          <p>
            <b className="baseline-key" />
            Baseline path{" "}
            {p.route.scenarioRoute && (
              <>
                <b className="scenario-key" />
                Scenario
              </>
            )}
          </p>
        )}
        {p.scenario && (
          <p>
            <i />
            Scenario water above adjusted DSM
          </p>
        )}
      </div>
      <div className="map-instruction">
        Click the map to inspect a raster cell
      </div>
    </div>
  );
}

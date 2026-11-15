"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import nisarComparison from "@data/nasa/nisar/comparison/manifest.json";
import type { RadarSource, NisarDisplay } from "@/domain/nisar-browse";
import { radarRgba } from "@/domain/nisar-science";
import type { NisarPolarization, NisarSciencePair } from "@/domain/nisar-science";
import { tippingBottleneck } from "@/domain/routing-bottleneck";
import BottleneckOverlay from "./BottleneckOverlay";

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
          '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">&copy; OpenStreetMap contributors</a>',
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
  science: NisarSciencePair | null;
  nisarPolarization: NisarPolarization;
  radarSource: RadarSource;
  nisarDisplay: NisarDisplay;
  route: RouteResponse | null;
  scenario: ScenarioInputs | null;
  radar: boolean;
  roads: boolean;
  point: Coordinate;
  transect: ReferenceTransect;
  onTransectSelect: (index: number) => void;
  autoFitToken: number | null;
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
    lastAutoFit = useRef<number | null>(null),
    latest = useRef(p);
  const [ready, setReady] = useState(false),
    [curtain, setCurtain] = useState(50);
  const bottleneck = useMemo(
    () => p.radarSource === "sentinel-1" ? tippingBottleneck(p.route) : null,
    [p.route, p.radarSource],
  );
  latest.current = p;
  const scienceImages = useMemo(() => {
    if (!p.science) return null;
    const band = p.nisarPolarization === "HH" ? 0 : 1;
    const range: [number, number] = band === 0 ? [-25, 10] : [-35, 0];
    return [p.science.after, p.science.before, p.science.change].map((raster, index) => {
      const canvas = document.createElement("canvas");
      canvas.width = raster.width;
      canvas.height = raster.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Calibrated radar rendering unavailable");
      const pixels = context.createImageData(raster.width, raster.height);
      pixels.data.set(radarRgba(raster, band, index === 2 ? [-6, 6] : range, index === 2));
      context.putImageData(pixels, 0, 0);
      return canvas.toDataURL("image/png");
    });
  }, [p.science, p.nisarPolarization]);
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
      attributionControl: { compact: false },
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
    const endpointMarkers: maplibregl.Marker[] = [];
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
          id: "marikina-corridor",
          type: "line",
          source: "waterways",
          filter: ["==", ["get", "name"], "Marikina River"],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#36899b",
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              10,
              9,
              13,
              18,
              16,
              30,
            ],
            "line-opacity": 0.2,
          },
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
          id: "marikina-centerline",
          type: "line",
          source: "waterways",
          filter: ["==", ["get", "name"], "Marikina River"],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#287a8a",
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              10,
              1.2,
              13,
              2.5,
              16,
              4,
            ],
            "line-opacity": 0.95,
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
            "line-color": "#83566e",
            "line-width": 1.2,
            "line-opacity": 0.45,
          },
        });
        map.addSource("additional-closures", { type: "geojson", data: EMPTY });
        map.addLayer({
          id: "additional-closures",
          type: "line",
          source: "additional-closures",
          paint: {
            "line-color": "#a47122",
            "line-width": 1.8,
            "line-opacity": 0.8,
          },
        });
        map.addSource("unknown-closures", { type: "geojson", data: EMPTY });
        map.addLayer({
          id: "unknown-closures",
          type: "line",
          source: "unknown-closures",
          paint: {
            "line-color": "#414743",
            "line-width": 2.2,
            "line-dasharray": [2, 2],
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
          id: "transect-halo",
          type: "line",
          source: "transect",
          paint: {
            "line-color": "#fffef5",
            "line-width": 4,
            "line-opacity": 0.9,
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
        for (const [label, index] of [
          ["A", 0],
          ["B", p.transect.samples.length - 1],
        ] as const) {
          const sample = p.transect.samples[index];
          const marker = document.createElement("button");
          marker.type = "button";
          marker.className = "transect-endpoint";
          marker.textContent = label;
          marker.title = `${label} · ${(sample.distance_m / 1000).toFixed(3)} km`;
          marker.setAttribute(
            "aria-label",
            `Inspect transect endpoint ${label}`,
          );
          if (map === comparison) {
            marker.tabIndex = -1;
            marker.setAttribute("aria-hidden", "true");
          }
          marker.addEventListener("click", (event) => {
            event.stopPropagation();
            latest.current.onTransectSelect(index);
          });
          endpointMarkers.push(
            new maplibregl.Marker({ element: marker, anchor: "center" })
              .setLngLat([sample.lon, sample.lat])
              .addTo(map),
          );
        }
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
      endpointMarkers.forEach((marker) => marker.remove());
      maps.current = [];
      primary.remove();
      comparison.remove();
    };
  }, [p.transect]);
  useEffect(() => {
    if (!ready || (p.radarSource === "sentinel-1" && !p.rasters) || (p.radarSource === "nisar-science" && !scienceImages)) return;
    const bounds = nisarComparison.grid.boundsWgs84;
    const nisarCorners: typeof rasterCorners = [
      [bounds.west, bounds.north],
      [bounds.east, bounds.north],
      [bounds.east, bounds.south],
      [bounds.west, bounds.south],
    ];
    const images =
      p.radarSource === "nisar"
        ? (p.nisarDisplay === "difference"
            ? [
                nisarComparison.difference.image.path,
                nisarComparison.difference.image.path,
              ]
            : [
                nisarComparison.records[1].aligned.path,
                nisarComparison.records[0].aligned.path,
              ]
          ).map((path) => `/data/nasa/nisar/${path}`)
        : p.radarSource === "nisar-science"
          ? p.nisarDisplay === "difference" ? [scienceImages![2], scienceImages![2]] : scienceImages!.slice(0, 2)
          : [rasterImage(p.rasters!.post), rasterImage(p.rasters!.baseline)];
    maps.current.forEach((map, index) => {
      (map.getSource("radar") as ImageSource).updateImage({
        url: images[index],
        coordinates: p.radarSource === "nisar" ? nisarCorners : rasterCorners,
      });
      map.setPaintProperty("radar", "raster-resampling", "nearest");
    });
  }, [ready, p.rasters, p.radarSource, p.nisarDisplay, scienceImages]);
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
        p.radar && (p.radarSource === "nisar" || (p.radarSource === "nisar-science" ? p.science : p.rasters))
          ? "visible"
          : "none",
      );
      map.setLayoutProperty(
        "roads",
        "visibility",
        p.roads && p.radarSource === "sentinel-1" ? "visible" : "none",
      );
      for (const id of [
        "hospitals",
        "closures",
        "additional-closures",
        "unknown-closures",
        "route-halo",
        "route",
        "anchors",
      ])
        map.setLayoutProperty(
          id,
          "visibility",
          p.radarSource === "sentinel-1" ? "visible" : "none",
        );
      map.setPaintProperty(
        "radar",
        "raster-opacity",
        p.radarSource === "sentinel-1" ? 0.8 : 1,
      );
    });
  }, [ready, p.radar, p.roads, p.rasters, p.science, p.radarSource]);
  useEffect(() => {
    if (!ready || !p.rasters) return;
    const url =
      p.scenario && p.radarSource === "sentinel-1"
        ? rasterImage(p.rasters.dem, p.scenario)
        : null;
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
  }, [ready, p.rasters, p.scenario, p.radarSource]);
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
    const closureCollection = (
      collection:
        | NonNullable<RouteResponse["scenarioSummary"]>["closures"]
        | undefined,
    ): FeatureCollection => ({
      type: "FeatureCollection",
      features: (collection?.features ?? []).map((feature) => ({
        ...feature,
        geometry: {
          type: "MultiLineString",
          coordinates: feature.geometry.coordinates.map((line) =>
            line.map((coordinate) => [...coordinate]),
          ),
        },
      })),
    });
    const closures = closureCollection(p.route?.scenarioSummary?.closures);
    const additionalClosures = closureCollection(
      p.route?.scenarioSummary?.additionalClosures,
    );
    const unknownClosures = closureCollection(
      p.route?.scenarioSummary?.unknownClosures,
    );
    maps.current.forEach((map) => {
      (map.getSource("routes") as GeoJSONSource).setData({
        type: "FeatureCollection",
        features,
      });
      (map.getSource("closures") as GeoJSONSource).setData(closures);
      (map.getSource("additional-closures") as GeoJSONSource).setData(
        additionalClosures,
      );
      (map.getSource("unknown-closures") as GeoJSONSource).setData(
        unknownClosures,
      );
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
  const fitRoute = useCallback(() => {
    const coordinates =
      p.route?.scenarioRoute?.feature?.geometry.coordinates ??
      p.route?.withoutLoweringRoute?.feature?.geometry.coordinates ??
      p.route?.baseline.feature?.geometry.coordinates;
    if (!coordinates?.length) return false;
    const bounds = new maplibregl.LngLatBounds();
    coordinates.forEach((coordinate) =>
      bounds.extend([coordinate[0], coordinate[1]]),
    );
    bottleneck?.edges.forEach((edge) => edge.coordinates.forEach((coordinate) =>
      bounds.extend([coordinate[0], coordinate[1]]),
    ));
    for (const sample of [
      p.transect.samples[0],
      p.transect.samples[p.transect.samples.length - 1],
    ]) {
      bounds.extend([sample.lon, sample.lat]);
    }
    maps.current[0]?.fitBounds(bounds, {
      padding: 65,
      duration: 350,
      maxZoom: 14.5,
    });
    return true;
  }, [p.route, p.transect, bottleneck]);
  useEffect(() => {
    if (
      !ready ||
      p.autoFitToken === null ||
      p.autoFitToken === lastAutoFit.current
    )
      return;
    if (fitRoute()) lastAutoFit.current = p.autoFitToken;
  }, [ready, p.autoFitToken, fitRoute]);
  return (
    <div className="map-frame" data-map-ready={ready}>
      {ready && bottleneck && <BottleneckOverlay maps={maps.current} bottleneck={bottleneck} />}
      <div ref={lower} className="map-canvas" />
      <div
        ref={upper}
        className="map-canvas comparison-map"
        style={{ clipPath: `inset(0 ${100 - curtain}% 0 0)` }}
      />
      {p.radar &&
        !(p.radarSource !== "sentinel-1" && p.nisarDisplay === "difference") && (
          <>
            <div className="map-date before">
              {p.radarSource !== "sentinel-1" ? (
                <>
                  21 Oct 2026 <span>{p.radarSource === "nisar" ? "NISAR RGB browse" : `NISAR γ⁰ ${p.nisarPolarization} / dB`}</span>
                </>
              ) : (
                <>
                  10 Jul 2024 <span>Sentinel-1 VV</span>
                </>
              )}
            </div>
            <div className="map-date after">
              {p.radarSource !== "sentinel-1" ? (
                <>
                  2 Nov 2026 <span>{p.radarSource === "nisar" ? "NISAR RGB browse" : `NISAR γ⁰ ${p.nisarPolarization} / dB`}</span>
                </>
              ) : (
                <>
                  3 Aug 2024 <span>Sentinel-1 VV</span>
                </>
              )}
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
        {p.radarSource === "nisar" && (
          <button
            onClick={() => {
              const b = nisarComparison.grid.boundsWgs84;
              maps.current[0]?.fitBounds(
                [
                  [b.west, b.south],
                  [b.east, b.north],
                ],
                { padding: 55, duration: 350 },
              );
            }}
          >
            NISAR common grid
          </button>
        )}
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
      <div className="map-legend" aria-label="Map legend">
        {p.radar && p.radarSource === "nisar-science" && <div className="radar-legend">
          <span>{p.nisarDisplay === "difference" ? `12-day Δγ⁰ ${p.nisarPolarization} / dB` : `Calibrated γ⁰ ${p.nisarPolarization} / dB`}</span>
          <div className={p.nisarDisplay === "difference" ? "nisar-difference-ramp" : "radar-ramp"} />
          <div className="ramp-values"><span>{p.nisarDisplay === "difference" ? "≤ −6" : p.nisarPolarization === "HH" ? "≤ −25" : "≤ −35"}</span>{p.nisarDisplay === "difference" && <span>0</span>}<span>{p.nisarDisplay === "difference" ? "≥ +6" : p.nisarPolarization === "HH" ? "≥ +10" : "≥ 0"}</span></div>
          <span>Shade clipped · readouts retain full values</span>
        </div>}
        {p.radar && p.radarSource === "sentinel-1" && (
          <div className="radar-legend">
            <span>γ⁰ VV / dB</span>
            <div className="radar-ramp" />
            <div className="ramp-values">
              <span>−25</span>
              <span>+5</span>
            </div>
          </div>
        )}
        {p.radar && p.radarSource === "nisar" && (
          <div className="radar-legend">
            <span>
              {p.nisarDisplay === "pair"
                ? "Provider RGB · display codes"
                : "2 Nov − 21 Oct · display DN"}
            </span>
            {p.nisarDisplay === "difference" && (
              <>
                <div className="nisar-difference-ramp" />
                <div className="ramp-values">
                  <span>≤ −64</span>
                  <span>0</span>
                  <span>≥ +64</span>
                </div>
              </>
            )}
            <span>200 m projected cells</span>
          </div>
        )}
        <p title="OSM centerline with screen-space emphasis; the casing does not measure river width.">
          <b className="river-key" aria-hidden="true" />
          Marikina River · OSM centerline
        </p>
        {p.radarSource === "sentinel-1" && p.route?.baseline.feature && (
          <p>
            <b className="baseline-key" aria-hidden="true" />
            Baseline path
          </p>
        )}
        {p.radarSource === "sentinel-1" && p.route?.scenarioRoute?.feature && (
          <p>
            <b className="scenario-key" aria-hidden="true" />
            Scenario path
          </p>
        )}
        {p.radarSource === "sentinel-1" &&
          !!p.route?.scenarioSummary?.closures.features.length && (
            <p>
              <b className="closure-key" aria-hidden="true" />
              Modeled depth &gt; 0.30 m
            </p>
          )}
        {p.radarSource === "sentinel-1" &&
          !!p.route?.scenarioSummary?.additionalClosures.features.length && (
            <p title="Known-depth edges newly excluded by the specified surface lowering, compared with the same water level and no lowering.">
              <b className="additional-closure-key" aria-hidden="true" />
              Additional closures · lowering
            </p>
          )}
        {p.radarSource === "sentinel-1" &&
          !!p.route?.scenarioSummary?.unknownClosures.features.length && (
            <p>
              <b className="unknown-key" aria-hidden="true" />
              Unknown DSM · excluded
            </p>
          )}
        {p.scenario && p.radarSource === "sentinel-1" && (
          <p>
            <i aria-hidden="true" />
            Scenario water above adjusted DSM
          </p>
        )}
      </div>
    </div>
  );
}

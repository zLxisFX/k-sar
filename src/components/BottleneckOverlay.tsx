"use client";
import { useEffect } from "react";
import { Marker, type Map as MapInstance } from "maplibre-gl";
import type { tippingBottleneck } from "@/domain/routing-bottleneck";

export default function BottleneckOverlay({
  maps,
  bottleneck,
}: {
  maps: MapInstance[];
  bottleneck: NonNullable<ReturnType<typeof tippingBottleneck>>;
}) {
  useEffect(() => {
    const markers: Marker[] = [];
    const color = bottleneck.excluded ? "#923f35" : "#80581c";
    for (const [index, map] of maps.entries()) {
      map.addSource("selected-bottleneck", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: bottleneck.edges.map((edge) => ({
            type: "Feature",
            properties: { edgeId: edge.id },
            geometry: { type: "LineString", coordinates: edge.coordinates.map((point) => [...point]) },
          })),
        },
      });
      map.addLayer({ id: "bottleneck-halo", type: "line", source: "selected-bottleneck",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#fffef5", "line-width": 10 } });
      map.addLayer({ id: "bottleneck-edge", type: "line", source: "selected-bottleneck",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": color, "line-width": 5 } });
      for (const edge of bottleneck.edges) {
        const midpoint = edge.coordinates[Math.floor(edge.coordinates.length / 2)];
        const label = document.createElement("a");
        label.className = `bottleneck-label${bottleneck.excluded ? " excluded" : ""}`;
        label.href = bottleneck.proofUrl;
        label.target = "_blank";
        label.rel = "noreferrer";
        label.title = `Directed edge ${edge.id} · ${edge.name}. Mathematical cut for Tumana to the selected Amang anchor in the sampled-DSM model; not a surveyed road failure. Open the reproducible graph proof.`;
        const heading = document.createElement("strong");
        heading.textContent = `Modeled cut · edge ${edge.id}`;
        const name = document.createElement("span");
        name.textContent = edge.name;
        const state = document.createElement("span");
        state.textContent = bottleneck.excluded ? "Excluded after 0.390 m lowering" : "Open without lowering";
        label.append(heading, name, state);
        label.addEventListener("click", (event) => event.stopPropagation());
        if (index !== 0) { label.tabIndex = -1; label.setAttribute("aria-hidden", "true"); }
        markers.push(new Marker({ element: label, anchor: "top-right", offset: [-8, 12] })
          .setLngLat([midpoint[0], midpoint[1]]).addTo(map));
      }
    }
    return () => {
      markers.forEach((marker) => marker.remove());
      for (const map of maps) {
        if (!map.getStyle()) continue;
        for (const id of ["bottleneck-edge", "bottleneck-halo"]) if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource("selected-bottleneck")) map.removeSource("selected-bottleneck");
      }
    };
  }, [maps, bottleneck]);
  return null;
}

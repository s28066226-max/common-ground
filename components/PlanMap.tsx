"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

export interface MapStop {
  n: number;
  name: string;
  slot: string;
  lat: number;
  lon: number;
}

// Leaflet touches `window`, so it is imported lazily, in the browser only.
export function PlanMap({ stops }: { stops: MapStop[] }) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    import("leaflet").then((L) => {
      if (disposed || !el.current) return;
      const map = L.map(el.current, { scrollWheelZoom: false, attributionControl: true });
      // Standard OSM tiles need no key; dark mode darkens them in CSS (.plan-map).
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      const points = stops.map((s) => {
        const icon = L.divIcon({
          className: "",
          html: `<div class="map-pin">${s.n}</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });
        L.marker([s.lat, s.lon], { icon, title: s.name })
          .addTo(map)
          .bindPopup(`<strong>${escapeHtml(s.name)}</strong><br/>${escapeHtml(s.slot)}`);
        return L.latLng(s.lat, s.lon);
      });
      if (points.length > 1) {
        L.polyline(points, { color: "#e4572e", weight: 2, opacity: 0.6, dashArray: "4 6" }).addTo(map);
        map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 15 });
      } else {
        map.setView(points[0], 14);
      }
      cleanup = () => map.remove();
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [stops]);

  return <div ref={el} className="plan-map h-64 w-full sm:h-72" role="region" aria-label="Map of the plan's stops" />;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

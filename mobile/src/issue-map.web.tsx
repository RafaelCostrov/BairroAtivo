import { useEffect, useRef, useState } from "react";
import type { Map } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { IssueMapProps } from "./map-points";
import { mapCenter, pinColors } from "./map-points";
import { statusLabel } from "./theme";
import { State } from "./ui";

export function IssueMapView({
  points,
  onOpen,
  label: mapLabel = "Mapa de ocorrências",
}: IssueMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let map: Map | undefined;
    void import("leaflet")
      .then((L) => {
        if (!active || !container.current) return;
        map = L.map(container.current);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 19,
        }).addTo(map);
        const positions = points.map(({ latitude, longitude }) =>
          L.latLng(latitude, longitude),
        );
        if (positions.length)
          map.fitBounds(L.latLngBounds(positions), {
            padding: [30, 30],
            maxZoom: 15,
          });
        else map.setView([mapCenter.latitude, mapCenter.longitude], 4);
        for (const point of points) {
          const color = pinColors[point.status];
          const marker = L.marker([point.latitude, point.longitude], {
            icon: L.divIcon({
              className: "",
              html:
                '<span style="display:block;width:16px;height:16px;border:2px solid white;border-radius:50%;background:' +
                color +
                '"></span>',
              iconSize: [20, 20],
            }),
            title: point.title,
            alt: point.title,
          });
          const label = document.createElement("span");
          label.textContent = point.title + " · " + statusLabel[point.status];
          marker.bindTooltip(label).addTo(map);
          if (onOpen) marker.on("click", () => onOpen(point.id));
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      map?.remove();
    };
  }, [points, onOpen, attempt]);

  if (failed) {
    return (
      <State
        title="Mapa indisponível"
        retry={() => {
          setFailed(false);
          setAttempt((current) => current + 1);
        }}
      />
    );
  }

  return (
    <div
      ref={container}
      aria-label={mapLabel}
      style={{ flex: 1, minHeight: 180 }}
    />
  );
}

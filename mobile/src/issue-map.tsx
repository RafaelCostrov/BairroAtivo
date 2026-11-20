import { useMemo } from "react";
import MapView, { Marker } from "react-native-maps";
import type { IssueMapProps } from "./map-points";
import { mapCenter, pinColors } from "./map-points";
import { statusLabel } from "./theme";

export function IssueMapView({
  points,
  onOpen,
  label = "Mapa de ocorrências",
}: IssueMapProps) {
  const region = useMemo(() => {
    if (!points.length)
      return { ...mapCenter, latitudeDelta: 41, longitudeDelta: 47 };
    const latitudes = points.map((point) => point.latitude);
    const longitudes = points.map((point) => point.longitude);
    const south = Math.min(...latitudes);
    const north = Math.max(...latitudes);
    const west = Math.min(...longitudes);
    const east = Math.max(...longitudes);
    return {
      latitude: (south + north) / 2,
      longitude: (west + east) / 2,
      latitudeDelta: Math.min(180, Math.max(0.012, (north - south) * 1.45)),
      longitudeDelta: Math.min(360, Math.max(0.012, (east - west) * 1.45)),
    };
  }, [points]);

  return (
    <MapView
      key={[
        region.latitude,
        region.longitude,
        region.latitudeDelta,
        region.longitudeDelta,
      ].join(":")}
      accessibilityLabel={label}
      style={{ flex: 1 }}
      initialRegion={region}
    >
      {points.map((point) => (
        <Marker
          key={point.id}
          coordinate={{ latitude: point.latitude, longitude: point.longitude }}
          title={point.title}
          description={point.neighborhood + " · " + statusLabel[point.status]}
          pinColor={pinColors[point.status]}
          onPress={onOpen ? () => onOpen(point.id) : undefined}
        />
      ))}
    </MapView>
  );
}

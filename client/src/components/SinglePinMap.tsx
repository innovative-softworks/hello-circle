import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import { colors } from "../theme";

// Same marker-icon fix DiscoveryMap.tsx already needs — Vite hashes
// Leaflet's default marker image URLs, so they have to be pointed at the
// bundled asset explicitly. Importing this module a second time (alongside
// DiscoveryMap.tsx) is harmless — mergeOptions is idempotent.
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

/** A single-pin map for one listing's own detail page (Experience/Adventure
 * "Location" section) — DiscoveryMap.tsx is the multi-pin browse version;
 * this is deliberately its own small component rather than DiscoveryMap
 * with a one-item array, since it doesn't need county-wide zoom or a
 * navigate-to-listing popup action (you're already on that listing). */
export function SinglePinMap({ lat, lng, label, height = 260 }: { lat: number; lng: number; label: string; height?: number }) {
  return (
    <div style={{ borderRadius: 14, overflow: "hidden", border: `1px solid ${colors.border}`, height }}>
      <MapContainer center={[lat, lng]} zoom={12} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={[lat, lng]}>
          <Popup>{label}</Popup>
        </Marker>
      </MapContainer>
    </div>
  );
}

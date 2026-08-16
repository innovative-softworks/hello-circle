import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useNavigate } from "react-router-dom";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import { euro } from "../euro";
import type { Centre, Club } from "../types";

// Vite bundles Leaflet's default marker images under a hashed URL that the
// library's own CSS doesn't know about — point the default icon at the
// bundled asset URLs explicitly, once, at module load.
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const IRELAND_CENTER: [number, number] = [53.4, -8.0];

export function DiscoveryMap({ centres, clubs }: { centres: Centre[]; clubs: Club[] }) {
  const navigate = useNavigate();
  const pins = [
    ...centres.filter((c) => c.lat !== null && c.lng !== null).map((c) => ({ kind: "centre" as const, item: c })),
    ...clubs.filter((c) => c.lat !== null && c.lng !== null).map((c) => ({ kind: "club" as const, item: c })),
  ];

  return (
    <div style={{ borderRadius: 16, overflow: "hidden", border: "1px solid #E4E1D8", height: 520 }}>
      <MapContainer center={IRELAND_CENTER} zoom={7} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {pins.map(({ kind, item }) => (
          <Marker key={`${kind}-${item.id}`} position={[item.lat as number, item.lng as number]}>
            <Popup>
              <div style={{ minWidth: 160 }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>{item.name}</div>
                <div style={{ fontSize: 12.5, color: "#5B635C", marginBottom: 6 }}>
                  {item.area} · {item.county}
                </div>
                <div style={{ fontSize: 12.5, marginBottom: 8 }}>
                  {kind === "centre" ? `From ${euro((item as Centre).from)}` : euro((item as Club).price) + ` / ${(item as Club).unit}`}
                </div>
                <button
                  onClick={() => navigate(kind === "centre" ? `/centres/${item.id}` : `/clubs/${item.id}`)}
                  style={{ background: "#1C5B3D", color: "#fff", border: "none", borderRadius: 8, padding: "6px 10px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
                >
                  View details
                </button>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

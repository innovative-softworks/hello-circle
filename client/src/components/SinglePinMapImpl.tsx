import { useState } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import Map, { Marker, Popup } from "react-map-gl";
import { MAPBOX_STYLE, MAPBOX_TOKEN } from "../mapbox";
import { colors } from "../theme";

function UnavailableFallback({ height, message }: { height: number; message: string }) {
  return (
    <div
      style={{
        borderRadius: 14,
        border: `1px solid ${colors.border}`,
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: colors.mutedLight,
        fontSize: 13.5,
        textAlign: "center",
        padding: 16,
      }}
    >
      {message}
    </div>
  );
}

/** The real Mapbox GL implementation — see SinglePinMap.tsx's wrapper
 * comment for why this lives in its own dynamically-imported module. */
export function SinglePinMap({ lat, lng, label, height = 260, zoom = 12 }: { lat: number; lng: number; label: string; height?: number; zoom?: number }) {
  const [popupOpen, setPopupOpen] = useState(true);
  // Runtime load failure (network blocked, invalid/revoked token, style
  // fetch error) — distinct from MAPBOX_TOKEN being unset below. Without
  // this, a failed style/tile load leaves a blank grey box with no
  // explanation (spec: "Provide loading, failure and unavailable states").
  const [loadFailed, setLoadFailed] = useState(false);

  if (!MAPBOX_TOKEN) {
    return <UnavailableFallback height={height} message="Map is temporarily unavailable." />;
  }
  if (loadFailed) {
    return <UnavailableFallback height={height} message="Map failed to load. The address is shown above." />;
  }

  return (
    <div style={{ borderRadius: 14, overflow: "hidden", border: `1px solid ${colors.border}`, height }}>
      <Map
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={{ longitude: lng, latitude: lat, zoom }}
        mapStyle={MAPBOX_STYLE}
        style={{ width: "100%", height: "100%" }}
        scrollZoom={false}
        dragRotate={false}
        touchPitch={false}
        onError={() => setLoadFailed(true)}
      >
        <Marker longitude={lng} latitude={lat} anchor="bottom">
          <div style={{ width: 16, height: 16, borderRadius: "50%", background: colors.dark, border: "2px solid #fff", boxShadow: "0 1px 4px rgba(0,0,0,.3)" }} />
        </Marker>
        {popupOpen && (
          <Popup longitude={lng} latitude={lat} onClose={() => setPopupOpen(false)} closeOnClick={false} anchor="bottom" offset={16}>
            {label}
          </Popup>
        )}
      </Map>
    </div>
  );
}

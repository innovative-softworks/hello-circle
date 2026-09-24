import { lazy, Suspense, useState } from "react";
import { PinIcon } from "./icons";
import { MAPS_ENABLED } from "../mapbox";
import { useMapsEnabled } from "../mapsConfig";
import { colors } from "../theme";

/** A single-pin map for one listing's own detail page (Experience/Adventure
 * "Location" section, GameLocationCard, ProviderProfile, AddressSearch's
 * confirm-pin step) — DiscoveryMap.tsx is the multi-pin/clustered browse
 * version.
 *
 * Click-to-open (Maps cost-control follow-up pass, §3): the map does NOT
 * initialize on ordinary page load. Venue name/address/"Get directions" are
 * each page's own sibling content (unchanged) — this component only owns
 * the map area itself, which starts as a static "View map" placeholder and
 * only mounts the real Mapbox GL instance once clicked. That mount then
 * persists (this component doesn't re-gate itself on prop changes), so
 * panning/zooming the opened map never re-triggers this gate.
 *
 * The real Mapbox GL implementation lives in SinglePinMapImpl.tsx, loaded
 * via `React.lazy` only once `open` flips true — so visiting a detail page
 * fetches neither the mapbox-gl bundle nor initializes a map until the
 * viewer actually asks to see one. */
const SinglePinMapImpl = lazy(() => import("./SinglePinMapImpl").then((m) => ({ default: m.SinglePinMap })));

export function SinglePinMap(props: { lat: number; lng: number; label: string; height?: number; zoom?: number }) {
  const [open, setOpen] = useState(false);
  const height = props.height ?? 260;

  // Two kill switches (see DiscoveryMap.tsx's identical check for the full
  // rationale) — checked before the "View map" button even renders, so a
  // disabled deploy doesn't offer an interaction that would just fail.
  const runtimeEnabled = useMapsEnabled();
  if (!MAPS_ENABLED || runtimeEnabled === false) {
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
        Map is temporarily unavailable.
      </div>
    );
  }
  if (runtimeEnabled === null) {
    return <div style={{ borderRadius: 14, border: `1px solid ${colors.border}`, height, background: colors.panel }} />;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`View map for ${props.label}`}
        style={{
          width: "100%",
          height,
          borderRadius: 14,
          border: `1px solid ${colors.border}`,
          background: colors.panel,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          cursor: "pointer",
          padding: 0,
        }}
      >
        <PinIcon size={22} style={{ color: colors.mutedLight }} />
        <span style={{ fontSize: 13.5, fontWeight: 700, color: colors.text }}>View map</span>
      </button>
    );
  }

  return (
    <Suspense fallback={<div style={{ borderRadius: 14, border: `1px solid ${colors.border}`, height, background: colors.panel }} />}>
      <SinglePinMapImpl {...props} />
    </Suspense>
  );
}

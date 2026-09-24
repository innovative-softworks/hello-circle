import { lazy, Suspense } from "react";
import type { MapMarkerFilters } from "../api";
import { MAPS_ENABLED } from "../mapbox";
import { useMapsEnabled } from "../mapsConfig";
import type { MapMarkerType } from "../types";
import { colors, radius } from "../theme";

/** Normalized shape every browse page (Browse.tsx's centres/clubs,
 * ExperienceKindBrowse.tsx's experiences/adventures) maps its own data into
 * before handing it to this component — kept deliberately generic (not
 * `Centre | Club | Experience`) so DiscoveryMapImpl.tsx has no knowledge of
 * any one entity's fields; each page owns its own subtitle/price-label
 * formatting. Lives in this (non-Mapbox-importing) module so consumers can
 * import the type without pulling in the lazy chunk below. */
export interface DiscoveryMapPin {
  id: string;
  lat: number;
  lng: number;
  title: string;
  subtitle: string;
  priceLabel: string;
  href: string;
  /** Coordinate provenance (Maps cost-control follow-up pass) — when not
   * 'confirmed', the pin renders in a lighter/outlined style and the popup
   * labels it "Approximate area" rather than implying a precise venue
   * location. Optional so existing callers that don't have this info yet
   * default to the confirmed styling. */
  locationSource?: "confirmed" | "approximate" | "unknown";
}

// The actual Mapbox GL/react-map-gl implementation is dynamically imported —
// this file (statically imported by Browse.tsx/ExperienceKindBrowse.tsx at
// their page-chunk level) stays Mapbox-free so navigating to /centres or
// /experiences never fetches the ~500KB mapbox-gl bundle. It only loads once
// this component actually renders, i.e. once the user picks "Map" view.
const DiscoveryMapImpl = lazy(() => import("./DiscoveryMapImpl").then((m) => ({ default: m.DiscoveryMap })));

const unavailablePanel = (
  <div
    style={{
      borderRadius: radius.card,
      border: `1px solid ${colors.border}`,
      height: 520,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: colors.mutedLight,
      fontSize: 14,
      textAlign: "center",
      padding: 24,
    }}
  >
    Map is temporarily unavailable — browse the list instead.
  </div>
);

const loadingPanel = <div style={{ borderRadius: radius.card, border: `1px solid ${colors.border}`, height: 520, background: colors.panel }} />;

export function DiscoveryMap({
  pins,
  searchTypes,
  searchFilters,
}: {
  pins: DiscoveryMapPin[];
  searchTypes?: MapMarkerType[];
  /** The page's *current* text/price filters (Maps cost-control follow-up
   * pass, review point #2) — passed through unchanged to "Search this
   * area" so a live viewport query respects the same filters the list
   * panel already applies, not just entity type. Recomputed by the caller
   * on every render, so this always reflects the latest filter state even
   * though the user might click "Search this area" long after last
   * changing a filter. */
  searchFilters?: MapMarkerFilters;
}) {
  // Two checks, both before the lazy chunk even loads (an operator during a
  // real cost incident shouldn't still pay for downloading the ~500KB
  // mapbox-gl bundle just to show a fallback message):
  //  - MAPS_ENABLED: build-time hard disable (VITE_MAPBOX_ENABLED).
  //  - useMapsEnabled(): the actually-immediate runtime kill switch — a
  //    DB-backed setting an admin can flip with no rebuild/redeploy/restart.
  const runtimeEnabled = useMapsEnabled();
  if (!MAPS_ENABLED || runtimeEnabled === false) return unavailablePanel;
  if (runtimeEnabled === null) return loadingPanel;

  return (
    <Suspense fallback={loadingPanel}>
      <DiscoveryMapImpl pins={pins} searchTypes={searchTypes} searchFilters={searchFilters} />
    </Suspense>
  );
}

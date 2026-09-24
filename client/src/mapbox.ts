// Shared Mapbox GL config — every map component reads from here rather than
// hardcoding the token/style/default viewport separately (previously each of
// DiscoveryMap.tsx/SinglePinMap.tsx/ExperienceKindBrowse.tsx's private
// ExperienceMap re-imported Leaflet's default-marker-icon fix independently;
// this is the Mapbox-era equivalent single source of truth).
//
// MAPBOX_TOKEN is empty when unset (no Mapbox account configured yet) —
// callers must check it and render a fallback rather than mounting a broken
// map (spec §98: a missing/failed map provider must never take down the rest
// of Explore).
export const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined)?.trim() || "";

// Operational kill switch (Maps cost-control follow-up pass, §10) — distinct
// from MAPBOX_TOKEN being unset (a startup-config gap): this is a deliberate
// "turn maps off" lever for a real incident (e.g. Mapbox usage spiking
// unexpectedly, or the account temporarily suspended) without touching a
// token or redeploying with a different token value. Defaults enabled;
// set VITE_MAPBOX_ENABLED=false to force every map component into its
// "unavailable" fallback regardless of whether a valid token is present.
// This is an app-level switch a deploy controls, not a per-account or
// per-request Mapbox billing cap — see DEPLOYMENT.md for how to flip it and
// the README's Mapbox cost-risk note for what it does and doesn't guarantee.
export const MAPS_ENABLED = (import.meta.env.VITE_MAPBOX_ENABLED as string | undefined) !== "false";

// A quiet, low-noise neutral basemap (Mapbox's own light style) — closer to
// the brand's "editorial, restrained POI density" direction than the
// previous default OpenStreetMap raster tiles. A fully custom branded style
// (Mapbox Studio) is a follow-up, not part of this pass.
export const MAPBOX_STYLE = "mapbox://styles/mapbox/light-v11";

// [lng, lat] — Mapbox's coordinate order, unlike Leaflet's [lat, lng].
export const IRELAND_CENTER: [number, number] = [-8.0, 53.4];
export const IRELAND_DEFAULT_ZOOM = 6.4;

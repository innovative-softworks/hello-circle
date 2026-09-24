import { useMemo, useRef, useState } from "react";
import type { GeoJSONSource } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import Map, { Layer, Popup, Source } from "react-map-gl";
import type { MapLayerMouseEvent, MapRef, ViewStateChangeEvent } from "react-map-gl";
import { useNavigate } from "react-router-dom";
import { fetchMapMarkers, type MapMarkerFilters } from "../api";
import { euro } from "../euro";
import { formatPrice } from "../formatters";
import { IRELAND_CENTER, IRELAND_DEFAULT_ZOOM, MAPBOX_STYLE, MAPBOX_TOKEN } from "../mapbox";
import { colors, radius } from "../theme";
import type { MapMarker, MapMarkerType } from "../types";
import type { DiscoveryMapPin } from "./DiscoveryMap";
import { Spinner } from "./ui";

const MAP_MARKER_LIMIT_PER_TYPE = 500;

function markerToPin(m: MapMarker): DiscoveryMapPin {
  return {
    id: m.id,
    lat: m.lat,
    lng: m.lng,
    title: m.title,
    subtitle: `${m.area}${m.area && m.county ? " · " : ""}${m.county}`,
    priceLabel: m.type === "centre" ? `From ${euro(m.from)}` : m.type === "club" ? `${euro(m.price)} / ${m.unit}` : formatPrice(m.priceCents, { each: true }),
    href: m.href,
    locationSource: m.locationSource as DiscoveryMapPin["locationSource"],
  };
}

const SOURCE_ID = "hc-discovery-pins";
const CLUSTER_LAYER = "hc-clusters";
const CLUSTER_COUNT_LAYER = "hc-cluster-count";
const POINT_LAYER = "hc-unclustered-point";

function pinsToGeoJson(pins: DiscoveryMapPin[]): GeoJSON.FeatureCollection<GeoJSON.Point, { id: string; approximate: boolean }> {
  return {
    type: "FeatureCollection",
    features: pins.map((p) => ({
      type: "Feature",
      properties: { id: p.id, approximate: p.locationSource !== undefined && p.locationSource !== "confirmed" },
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
    })),
  };
}

/** The real Mapbox GL implementation — lives in its own module (imported only
 * via `React.lazy` from DiscoveryMap.tsx's wrapper) so the mapbox-gl/
 * react-map-gl bundle is only fetched once the user actually opens Map view,
 * not merely because the Browse/ExperienceKindBrowse route loaded (Maps &
 * Geographic Discovery cost-control pass, §1/§7: "Do NOT initialize Mapbox
 * simply because the Explore page loaded"). Clustering is Mapbox GL's own
 * built-in cluster support on the GeoJSON source (supercluster under the
 * hood) — deliberately not a hand-rolled clustering algorithm. */
export function DiscoveryMap({ pins, searchTypes, searchFilters }: { pins: DiscoveryMapPin[]; searchTypes?: MapMarkerType[]; searchFilters?: MapMarkerFilters }) {
  const navigate = useNavigate();
  const mapRef = useRef<MapRef>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Runtime load failure (network blocked, invalid/revoked token, style
  // fetch error) — distinct from MAPBOX_TOKEN being unset below. The list
  // view remains one click away either way (spec: Mapbox failure must never
  // make Explore fully unusable).
  const [loadFailed, setLoadFailed] = useState(false);

  // "Search this area" (Maps & Geographic Discovery, §7/§63-64) — wires the
  // bounds-scoped GET /api/discover/map endpoint into the map itself. Not
  // auto-triggered on pan/zoom (that would fire a request per drag pixel);
  // instead a button appears after the map settles from a move, and only a
  // deliberate click queries the server. `areaPins` is null until the user
  // does that at least once — until then the map shows exactly what its
  // caller passed in (the same list-driven pins as before this feature
  // existed), so pages that don't pass `searchTypes` are unaffected.
  const [showSearchButton, setShowSearchButton] = useState(false);
  const [areaPins, setAreaPins] = useState<DiscoveryMapPin[] | null>(null);
  const [areaSearching, setAreaSearching] = useState(false);
  const [areaError, setAreaError] = useState<string | null>(null);
  const [areaCapped, setAreaCapped] = useState(false);
  // Guards against a slow earlier request clobbering a faster later one —
  // "latest request wins" (spec §96/§110) — without pulling in
  // AbortController plumbing through the shared `request()` wrapper.
  const searchRequestId = useRef(0);

  const activePins = areaPins ?? pins;
  const geojson = useMemo(() => pinsToGeoJson(activePins), [activePins]);
  const selected = activePins.find((p) => p.id === selectedId) ?? null;

  const handleMoveEnd = (_e: ViewStateChangeEvent) => {
    if (searchTypes && searchTypes.length > 0) setShowSearchButton(true);
  };

  const searchThisArea = async () => {
    if (!searchTypes || searchTypes.length === 0 || !mapRef.current) return;
    const bounds = mapRef.current.getMap().getBounds();
    if (!bounds) return;
    const requestId = ++searchRequestId.current;
    setAreaSearching(true);
    setAreaError(null);
    setShowSearchButton(false);
    try {
      const { markers } = await fetchMapMarkers(
        { north: bounds.getNorth(), south: bounds.getSouth(), east: bounds.getEast(), west: bounds.getWest() },
        searchTypes,
        searchFilters
      );
      if (requestId !== searchRequestId.current) return; // a newer search superseded this one
      setAreaPins(markers.map(markerToPin));
      setAreaCapped(searchTypes.some((t) => markers.filter((m) => m.type === t).length >= MAP_MARKER_LIMIT_PER_TYPE));
      setSelectedId(null);
    } catch {
      if (requestId !== searchRequestId.current) return;
      setAreaError("Couldn't search this area — try again.");
    } finally {
      if (requestId === searchRequestId.current) setAreaSearching(false);
    }
  };

  const clearAreaSearch = () => {
    setAreaPins(null);
    setAreaError(null);
    setAreaCapped(false);
    setShowSearchButton(false);
    setSelectedId(null);
  };

  const unavailable = (message: string) => (
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
      {message}
    </div>
  );

  if (!MAPBOX_TOKEN) return unavailable("Map is temporarily unavailable — browse the list instead.");
  if (loadFailed) return unavailable("Map failed to load — browse the list instead.");

  const setCursor = (cursor: string) => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = cursor;
  };

  const handleClick = (e: MapLayerMouseEvent) => {
    const feature = e.features?.[0];
    if (!feature) {
      setSelectedId(null);
      return;
    }
    if (feature.layer?.id === CLUSTER_LAYER) {
      const clusterId = feature.properties?.cluster_id;
      const source = mapRef.current?.getMap().getSource(SOURCE_ID) as GeoJSONSource | undefined;
      const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
      if (source && clusterId !== undefined) {
        source.getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err || !mapRef.current || zoom == null) return;
          mapRef.current.easeTo({ center: coordinates, zoom, duration: 400 });
        });
      }
      return;
    }
    if (feature.layer?.id === POINT_LAYER) {
      setSelectedId((feature.properties?.id as string) ?? null);
    }
  };

  return (
    <div style={{ position: "relative", borderRadius: radius.card, overflow: "hidden", border: `1px solid ${colors.border}`, height: 520 }}>
      <Map
        ref={mapRef}
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={{ longitude: IRELAND_CENTER[0], latitude: IRELAND_CENTER[1], zoom: IRELAND_DEFAULT_ZOOM }}
        mapStyle={MAPBOX_STYLE}
        style={{ width: "100%", height: "100%" }}
        interactiveLayerIds={[CLUSTER_LAYER, POINT_LAYER]}
        onClick={handleClick}
        onMoveEnd={handleMoveEnd}
        onMouseEnter={() => setCursor("pointer")}
        onMouseLeave={() => setCursor("")}
        onError={() => setLoadFailed(true)}
      >
        <Source id={SOURCE_ID} type="geojson" data={geojson} cluster clusterMaxZoom={14} clusterRadius={50}>
          <Layer
            id={CLUSTER_LAYER}
            type="circle"
            filter={["has", "point_count"]}
            paint={{
              "circle-color": "#1e7a4c",
              "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 50, 26],
              "circle-stroke-width": 2,
              "circle-stroke-color": "#fff",
            }}
          />
          <Layer
            id={CLUSTER_COUNT_LAYER}
            type="symbol"
            filter={["has", "point_count"]}
            layout={{ "text-field": "{point_count_abbreviated}", "text-size": 13, "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"] }}
            paint={{ "text-color": "#fff" }}
          />
          <Layer
            id={POINT_LAYER}
            type="circle"
            filter={["!", ["has", "point_count"]]}
            paint={{
              // Approximate locations (county-centroid, not a confirmed
              // address) render lighter/outlined rather than solid — never
              // presented with the same visual confidence as a real pin
              // (spec: "clearly separate approximate results").
              "circle-color": ["case", ["get", "approximate"], "#ffffff", "#1e2420"],
              "circle-radius": 7,
              "circle-stroke-width": 2,
              "circle-stroke-color": ["case", ["get", "approximate"], "#9aa39c", "#fff"],
              "circle-opacity": ["case", ["get", "approximate"], 0.85, 1],
            }}
          />
        </Source>
        {selected && (
          <Popup longitude={selected.lng} latitude={selected.lat} onClose={() => setSelectedId(null)} closeOnClick={false} anchor="bottom" offset={12}>
            <div style={{ minWidth: 160 }}>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>{selected.title}</div>
              <div style={{ fontSize: 12.5, color: "#5B635C", marginBottom: 6 }}>{selected.subtitle}</div>
              {selected.locationSource !== undefined && selected.locationSource !== "confirmed" && (
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "#9a7b1f", marginBottom: 4 }}>Approximate area</div>
              )}
              <div style={{ fontSize: 12.5, marginBottom: 8 }}>{selected.priceLabel}</div>
              <button
                onClick={() => navigate(selected.href)}
                style={{ background: colors.dark, color: "#fff", border: "none", borderRadius: 8, padding: "6px 10px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
              >
                View details
              </button>
            </div>
          </Popup>
        )}
      </Map>

      {showSearchButton && !areaSearching && (
        <button
          onClick={searchThisArea}
          style={{
            position: "absolute",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            background: colors.dark,
            color: "#fff",
            border: "none",
            borderRadius: 20,
            padding: "9px 16px",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: "0 4px 14px rgba(0,0,0,.25)",
          }}
        >
          Search this area
        </button>
      )}

      {areaSearching && (
        <div
          style={{
            position: "absolute",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            background: colors.dark,
            color: "#fff",
            borderRadius: 20,
            padding: "9px 16px",
            fontSize: 13,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Spinner size={14} /> Searching this area…
        </div>
      )}

      {areaError && !areaSearching && (
        <div
          style={{
            position: "absolute",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#fff",
            color: colors.text,
            border: `1px solid ${colors.border}`,
            borderRadius: 20,
            padding: "9px 16px",
            fontSize: 13,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          {areaError}
          <button onClick={searchThisArea} style={{ background: "none", border: "none", color: colors.dark, fontWeight: 700, textDecoration: "underline", cursor: "pointer", padding: 0, fontSize: 13 }}>
            Retry
          </button>
        </div>
      )}

      {areaPins !== null && !areaSearching && !areaError && (
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            right: 12,
            background: "#fff",
            border: `1px solid ${colors.border}`,
            borderRadius: 12,
            padding: "8px 12px",
            fontSize: 12.5,
            color: colors.mutedLight,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            boxShadow: "0 4px 14px rgba(0,0,0,.1)",
          }}
        >
          <span>
            {areaPins.length === 0
              ? "Nothing here — try a different area, clear filters, or zoom out."
              : `Showing this area (${areaPins.length}${areaCapped ? "+" : ""}) — search and price filters carried over; amenity/accessibility filters apply once you're back in List view.`}
          </span>
          <button onClick={clearAreaSearch} style={{ background: "none", border: "none", color: colors.dark, fontWeight: 700, textDecoration: "underline", cursor: "pointer", padding: 0, fontSize: 12.5, flex: "none" }}>
            Back to my results
          </button>
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchCentre } from "../api";
import { colors } from "../theme";
import { VENUE_PAGES_PUBLIC } from "../venueLaunch";
import { DetailSection, LocationBlock } from "./detail/DetailSections";
import type { Game } from "../types";

// Location (Game Detail redesign §17/§18) — reuses SinglePinMap (already
// built for ExperienceDetail.tsx) rather than a new mapping integration.
// Games don't carry their own lat/lng, but a centre-hosted game's venue
// does — fetched only when centreId is set, and only to read lat/lng/lets
// the map render; nothing about that fetch is participant-only or exposed
// pre-join, since a venue's approximate public location is what "View
// venue" already links to. Exact meeting instructions (a different, more
// precise thing) are handled separately in GameDetail.tsx, gated to the
// host/joined participants at the API layer.

export function GameLocationCard({ game }: { game: Game }) {
  const navigate = useNavigate();
  const [centre, setCentre] = useState<{ lat: number | null; lng: number | null } | null>(null);

  useEffect(() => {
    if (!game.centreId) return;
    fetchCentre(game.centreId)
      .then((c) => setCentre({ lat: c.lat, lng: c.lng }))
      .catch(() => {});
  }, [game.centreId]);

  const directionsUrl = useMemo(() => {
    const query = game.centreName ?? game.locationText;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }, [game.centreName, game.locationText]);

  // Detail-page redesign — the shared location block (map opens in place).
  return (
    <DetailSection title="Location">
      <LocationBlock
        name={game.centreName ?? game.locationText}
        area={game.area}
        directionsUrl={directionsUrl}
        map={centre?.lat != null && centre?.lng != null ? { lat: centre.lat, lng: centre.lng, label: game.centreName ?? game.activityLabel } : null}
        extra={
          game.centreId && VENUE_PAGES_PUBLIC ? (
            <button type="button" className="tap-target" onClick={() => navigate(`/centres/${game.centreId}`)} style={{ fontSize: 13.5, fontWeight: 700, color: colors.text, textDecoration: "underline", textUnderlineOffset: 3, background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit" }}>
              View venue
            </button>
          ) : null
        }
      />
    </DetailSection>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchCentre } from "../api";
import { PinIcon } from "./icons";
import { SinglePinMap } from "./SinglePinMap";
import { colors, fonts } from "../theme";
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

  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 18, margin: "0 0 12px" }}>Location</h2>
      <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 14, padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: centre?.lat != null && centre?.lng != null ? 12 : 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <PinIcon size={16} style={{ color: colors.mutedLight, flex: "none" }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 14.5 }}>{game.centreName ?? game.locationText}</div>
            {/* `area` is already a "Town, County" composite in the seed data
                (e.g. "Portlaoise, Laois") — showing county again would duplicate it. */}
            {game.area && <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 2 }}>{game.area}</div>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, flex: "none" }}>
          {game.centreId && (
            <button onClick={() => navigate(`/centres/${game.centreId}`)} style={{ background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.text, cursor: "pointer", textDecoration: "underline" }}>
              View venue
            </button>
          )}
          <a href={directionsUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 700, color: colors.text, textDecoration: "underline" }}>
            Get directions
          </a>
        </div>
      </div>
      {centre?.lat != null && centre?.lng != null && <SinglePinMap lat={centre.lat} lng={centre.lng} label={game.centreName ?? game.activityLabel} height={240} />}
    </div>
  );
}

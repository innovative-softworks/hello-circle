import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchHostProfile } from "../api";
import { AwardIcon, StarIcon } from "./icons";
import { Avatar } from "./ui";
import { colors, fonts, radius } from "../theme";
import type { Game, HostProfile } from "../types";

// Host trust card (Game Detail redesign §15) — real stats only. gamesHostedTotal/
// rating/reviews/bio come from the existing host-profile endpoint (the same
// data HostProfile.tsx itself renders); this app has no "show-up rate" or
// "member since" anywhere, so — per the spec's own explicit instruction not
// to fabricate trust signals — those are simply never shown. HostProfile
// only ever resolves for a verified host (see HostProfile.tsx's own
// comment), so the extra fetch only fires when hostVerified is true; an
// unverified host still gets a name + avatar, just no stats/CTA.

export function GameHostCard({ game }: { game: Game }) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<HostProfile | null>(null);

  useEffect(() => {
    if (!game.hostVerified) return;
    fetchHostProfile(game.hostResidentId)
      .then(setProfile)
      .catch(() => {});
  }, [game.hostResidentId, game.hostVerified]);

  if (!game.hostName) return null;

  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 18, margin: "0 0 12px" }}>Hosted by</h2>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <Avatar name={game.hostName} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{game.hostName}</span>
            {game.hostVerified && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "2px 8px" }}>
                <AwardIcon size={11} /> Verified Host
              </span>
            )}
          </div>
          {profile && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, fontSize: 13, color: colors.mutedLight }}>
              <span>Hosted {profile.gamesHostedTotal} session{profile.gamesHostedTotal === 1 ? "" : "s"}</span>
              {profile.reviews > 0 && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                  <StarIcon size={12} style={{ color: colors.gold }} /> {profile.rating} ({profile.reviews})
                </span>
              )}
            </div>
          )}
          {profile?.bio && <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "#3B423C", lineHeight: 1.5 }}>{profile.bio}</p>}
          {game.hostVerified && (
            <button
              onClick={() => navigate(`/host/${game.hostResidentId}`)}
              style={{ background: "none", border: "none", padding: 0, marginTop: 8, fontSize: 12.5, fontWeight: 700, color: colors.text, cursor: "pointer", textDecoration: "underline" }}
            >
              View profile
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

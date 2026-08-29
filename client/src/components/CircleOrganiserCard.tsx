import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchHostProfile } from "../api";
import { AwardIcon, StarIcon } from "./icons";
import { Avatar } from "./ui";
import { colors, fonts, radius } from "../theme";
import type { Circle, HostProfile } from "../types";

// Organiser trust section (Circle Detail full rewrite §10/§14) — an
// editorial ~40/60 layout with a large avatar mark instead of a small
// sidebar-card row. Same real-stats-only stance as before: gamesHostedTotal/
// circles.length/rating/reviews/bio come from the existing host-profile
// endpoint. No "member since"/"show-up rate" — neither exists anywhere in
// this app. No fabricated portrait photo either — residents have no photo
// field in this app's data model, so a large Avatar (initials) mark is the
// honest equivalent of the reference's "large portrait."

export function CircleOrganiserCard({ circle }: { circle: Circle }) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<HostProfile | null>(null);

  useEffect(() => {
    if (!circle.hostVerified) return;
    fetchHostProfile(circle.createdByResidentId)
      .then(setProfile)
      .catch(() => {});
  }, [circle.createdByResidentId, circle.hostVerified]);

  if (!circle.hostName) return null;

  return (
    <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "5fr 7fr", gap: 40, alignItems: "center" }}>
      <div style={{ width: 160, height: 160, borderRadius: "50%", overflow: "hidden" }}>
        <Avatar name={circle.hostName} size={160} />
      </div>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
          <span style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 24, letterSpacing: "-.01em" }}>{circle.hostName}</span>
          {circle.hostVerified && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "3px 9px" }}>
              <AwardIcon size={11} /> Verified
            </span>
          )}
        </div>
        <div style={{ fontSize: 13.5, color: colors.mutedLight, marginBottom: 14 }}>Circle organiser</div>
        {profile && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 20, marginBottom: 14 }}>
            <div>
              <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 18 }}>{profile.circles.length}</div>
              <div style={{ fontSize: 12, color: colors.mutedLight }}>Circle{profile.circles.length === 1 ? "" : "s"} run</div>
            </div>
            {profile.gamesHostedTotal > 0 && (
              <div>
                <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 18 }}>{profile.gamesHostedTotal}</div>
                <div style={{ fontSize: 12, color: colors.mutedLight }}>Plans hosted</div>
              </div>
            )}
            {profile.reviews > 0 && (
              <div>
                <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 18, display: "flex", alignItems: "center", gap: 4 }}>
                  <StarIcon size={15} style={{ color: colors.gold }} /> {profile.rating}
                </div>
                <div style={{ fontSize: 12, color: colors.mutedLight }}>{profile.reviews} review{profile.reviews === 1 ? "" : "s"}</div>
              </div>
            )}
          </div>
        )}
        {profile?.bio && <p style={{ margin: "0 0 14px", fontSize: 14.5, color: "#3B423C", lineHeight: 1.6, maxWidth: 480 }}>{profile.bio}</p>}
        {circle.hostVerified && (
          <button
            onClick={() => navigate(`/host/${circle.createdByResidentId}`)}
            style={{ background: "none", border: "none", padding: 0, fontSize: 13.5, fontWeight: 700, color: colors.text, cursor: "pointer" }}
          >
            View profile →
          </button>
        )}
      </div>
    </div>
  );
}

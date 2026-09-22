import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchHostProfile } from "../api";
import { AwardIcon, CalendarIcon, RepeatIcon, StarIcon } from "../components/icons";
import { FollowButton } from "../components/FollowButton";
import { PageTitle } from "../components/PageTitle";
import { Reviews } from "../components/Reviews";
import { ShareButton } from "../components/ShareButton";
import { Avatar, Card, EmptyState, PageSpinner } from "../components/ui";
import { colors, fonts, radius } from "../theme";
import type { HostProfile } from "../types";

// Host public profile (IA spec §5/§15) — only ever resolves for a verified
// host, and only shows participation-relevant info (activities hosted,
// verification, hosting experience). Follow feature: this page previously
// had no followers/likes/social popularity by deliberate original design —
// that decision is now explicitly reversed for Follow specifically (a
// standing "keep me in the loop" relationship, not a like/popularity
// metric), per direct instruction. Follower count still stays a small
// secondary line, never a headline stat (see FollowButton.tsx).

export function HostProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<HostProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetchHostProfile(id)
      .then(setProfile)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <PageSpinner />;
  if (notFound || !profile) {
    return (
      <section className="section-pad" style={{ maxWidth: 640, margin: "0 auto", padding: "60px 24px", textAlign: "center" }}>
        <p style={{ color: colors.mutedLight }}>This host profile isn't available.</p>
      </section>
    );
  }

  return (
    <div style={{ animation: "fadeUp .3s ease both" }}>
      <section className="section-pad" style={{ maxWidth: 640, margin: "0 auto", padding: "36px 24px 80px" }}>
        <Card style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <Avatar name={profile.name} size={52} />
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <PageTitle level="section" style={{ margin: 0 }}>{profile.name}</PageTitle>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "3px 10px" }}>
                    <AwardIcon size={12} /> Verified Host
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <span style={{ color: colors.mutedLight, fontSize: 13.5 }}>Has hosted {profile.gamesHostedTotal} session{profile.gamesHostedTotal === 1 ? "" : "s"}</span>
                  {profile.reviews > 0 && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 13, color: colors.muted }}>
                      <StarIcon size={13} style={{ color: colors.gold }} /> {profile.rating} ({profile.reviews})
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ShareButton entityType="host" entityId={profile.id} />
              <FollowButton followedType="host" followedId={profile.id} initialFollowing={profile.isFollowing} initialLevel={profile.followNotificationLevel} followerCount={profile.followerCount} />
            </div>
          </div>
          {profile.bio && <p style={{ margin: "16px 0 0", color: "#3B423C", fontSize: 15, lineHeight: 1.55 }}>{profile.bio}</p>}
        </Card>

        <h4 style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 12px" }}>
          <CalendarIcon size={14} /> Upcoming sessions
        </h4>
        {profile.upcomingGames.length === 0 ? (
          <EmptyState icon={<CalendarIcon size={20} />} title="Nothing scheduled right now" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
            {profile.upcomingGames.map((g) => (
              <button
                key={g.id}
                onClick={() => navigate(`/games/${g.id}`)}
                style={{ textAlign: "left", background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 12, padding: "12px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between" }}
              >
                <span style={{ fontWeight: 600, fontSize: 14 }}>{g.activityLabel}</span>
                <span style={{ fontSize: 12.5, color: colors.mutedLight }}>{g.date} · {g.time}</span>
              </button>
            ))}
          </div>
        )}

        {profile.circles.length > 0 && (
          <>
            <h4 style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 12px" }}>
              <RepeatIcon size={14} /> Circles started
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {profile.circles.map((c) => (
                <button
                  key={c.id}
                  onClick={() => navigate(`/circles/${c.slug ?? c.id}`)}
                  style={{ textAlign: "left", background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 12, padding: "12px 14px", cursor: "pointer" }}
                >
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</span>
                  {c.activityLabel && <span style={{ fontSize: 12.5, color: colors.mutedLight, marginLeft: 8 }}>{c.activityLabel}</span>}
                </button>
              ))}
            </div>
          </>
        )}

        <div style={{ marginTop: 24 }}>
          <h4 style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 12px" }}>
            <StarIcon size={14} /> Reviews
          </h4>
          <Reviews listingType="host" listingId={profile.id} accent="green" />
        </div>
      </section>
    </div>
  );
}

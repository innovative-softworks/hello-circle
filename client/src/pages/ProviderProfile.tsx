import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchProviderProfile } from "../api";
import { AwardIcon, BallIcon, BuildingIcon, TreeIconSmall } from "../components/icons";
import { PageTitle } from "../components/PageTitle";
import { Card, PageSpinner } from "../components/ui";
import { colors, fonts, radius } from "../theme";
import type { ProviderProfile } from "../types";

// Provider public profile (IA spec §5) — a dedicated page for the vendor
// account behind a listing, distinct from any one listing's own detail
// page. Not designed like a follower-based creator profile — no likes,
// no post feed, just verification/description/listings/policies/support.

export function ProviderProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetchProviderProfile(id)
      .then(setProfile)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <PageSpinner />;
  if (notFound || !profile) {
    return (
      <section className="section-pad" style={{ maxWidth: 640, margin: "0 auto", padding: "60px 24px", textAlign: "center" }}>
        <p style={{ color: colors.mutedLight }}>This provider doesn't exist, or isn't approved yet.</p>
      </section>
    );
  }

  return (
    <div style={{ animation: "fadeUp .3s ease both" }}>
      <section className="section-pad" style={{ maxWidth: 780, margin: "0 auto", padding: "36px 24px 80px" }}>
        <Card style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <PageTitle level="section" style={{ margin: 0 }}>{profile.name}</PageTitle>
                {profile.verified && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "3px 10px" }}>
                    <AwardIcon size={12} /> Verified provider
                  </span>
                )}
              </div>
              <div style={{ color: colors.mutedLight, fontSize: 14, marginTop: 4 }}>{profile.county}</div>
            </div>
          </div>
          {profile.description && <p style={{ margin: "16px 0 0", color: "#3B423C", fontSize: 15, lineHeight: 1.55 }}>{profile.description}</p>}
        </Card>

        <Card style={{ marginBottom: 24 }}>
          <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 12px" }}>Policies</h4>
          <div style={{ display: "flex", gap: 24, fontSize: 13.5, color: colors.muted, flexWrap: "wrap" }}>
            <span>Cancellations: up to {profile.policies.cancellationHours}h before</span>
            <span>Bookings taken up to {profile.policies.bookingWindowDays} days ahead</span>
          </div>
        </Card>

        {[
          { key: "centres", label: "Community centres", icon: <BuildingIcon size={14} />, rows: profile.centres, to: (idOrSlug: string) => `/centres/${idOrSlug}` },
          { key: "clubs", label: "Sports clubs", icon: <BallIcon size={14} />, rows: profile.clubs, to: (idOrSlug: string) => `/clubs/${idOrSlug}` },
          { key: "experiences", label: "Adventures & Experiences", icon: <TreeIconSmall size={14} />, rows: profile.experiences, to: (idOrSlug: string, kind?: string) => `/${kind === "adventure" ? "adventures" : "experiences"}/${idOrSlug}` },
        ].map(
          (group) =>
            group.rows.length > 0 && (
              <div key={group.key} style={{ marginBottom: 24 }}>
                <h4 style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 12px" }}>
                  {group.icon} {group.label}
                </h4>
                <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
                  {group.rows.map((r: { id: string; slug?: string | null; name?: string; title?: string; area: string; county: string; kind?: string }) => (
                    <button
                      key={r.id}
                      onClick={() => navigate(group.to(r.slug ?? r.id, r.kind))}
                      style={{ textAlign: "left", background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 12, padding: 14, cursor: "pointer" }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{r.name ?? r.title}</div>
                      <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 2 }}>{r.area}, {r.county}</div>
                    </button>
                  ))}
                </div>
              </div>
            )
        )}

        <Card>
          <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, margin: "0 0 8px" }}>Need help?</h4>
          <p style={{ fontSize: 13.5, color: colors.mutedLight, margin: 0 }}>Contact HelloCircle support from Help &amp; Support in your account menu — we'll route it to the right place.</p>
        </Card>
      </section>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchInviteByToken, respondToInviteToken, type InviteTokenLookup } from "../api/invitations";
import { signInHref } from "../authRedirect";
import { Photo } from "../components/Photo";
import { Button, PageSpinner } from "../components/ui";
import { useGuest } from "../GuestContext";
import { colors, fonts } from "../theme";

// Universal Sharing & Invitation system §12 — the personal invitation
// landing experience. Deliberately its own page/route (/i/:token), distinct
// from /accept-invite (staff org invites — an unrelated, older flow, see
// AcceptInvite.tsx) and from the entity's own detail page: the invitation
// itself is the hero here, not a generic marketing landing.

const ENTITY_PATH: Record<string, string> = {
  centre: "/centres/",
  club: "/clubs/",
  circle: "/circles/",
  experience: "/experiences/",
  adventure: "/adventures/",
  game: "/games/",
  program: "/programs/",
  host: "/host/",
  provider: "/provider/",
};

export function InvitationLanding() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [data, setData] = useState<InviteTokenLookup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [responding, setResponding] = useState<string | null>(null);
  const [responded, setResponded] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetchInviteByToken(token)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "This invitation link isn't valid"));
  }, [token]);

  const respond = async (response: "accepted" | "maybe" | "declined") => {
    if (!token) return;
    setResponding(response);
    try {
      await respondToInviteToken(token, response);
      setResponded(response);
    } finally {
      setResponding(null);
    }
  };

  if (error) {
    return (
      <section className="section-pad" style={{ maxWidth: 480, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 22, margin: "0 0 10px" }}>This invitation isn't available.</h1>
        <p style={{ color: colors.mutedLight, marginBottom: 20 }}>{error}</p>
        <Button onClick={() => navigate("/explore")}>Explore HelloCircle</Button>
      </section>
    );
  }

  if (!data) return <PageSpinner />;

  const { entity } = data;
  const detailHref = `${ENTITY_PATH[entity.entityType] ?? "/"}${entity.entityId}`;

  if (data.status !== "pending" || responded) {
    const finalStatus = responded ?? data.status;
    const label = finalStatus === "accepted" ? "You're in!" : finalStatus === "maybe" ? "Marked as maybe" : finalStatus === "declined" ? "You've declined" : "This invitation has expired.";
    return (
      <section className="section-pad" style={{ maxWidth: 480, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 22, margin: "0 0 10px" }}>{label}</h1>
        <p style={{ color: colors.mutedLight, marginBottom: 20 }}>{entity.title}</p>
        <Button onClick={() => navigate(detailHref)}>View details</Button>
      </section>
    );
  }

  return (
    <section className="section-pad" style={{ maxWidth: 520, margin: "0 auto", padding: "56px 24px 80px" }}>
      <p style={{ fontSize: 13.5, color: colors.mutedLight, marginBottom: 4, fontWeight: 600 }}>{data.inviterName} invited you</p>
      <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(24px,3vw,32px)", margin: "0 0 18px", letterSpacing: "-.02em" }}>{entity.title}</h1>

      {entity.image && (
        <Photo src={entity.image} alt={entity.title} ph={colors.panel} style={{ width: "100%", height: 220, borderRadius: 16, overflow: "hidden", marginBottom: 18 }} />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 24, fontSize: 14.5, color: colors.text }}>
        {entity.location && <div>{entity.location}</div>}
        {entity.date && <div>{entity.date}{entity.time ? ` · ${entity.time}` : ""}</div>}
        {typeof entity.interestedCount === "number" && <div style={{ color: colors.mutedLight }}>{entity.interestedCount} people are joining</div>}
      </div>

      {!resident ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button onClick={() => navigate(signInHref({ kind: "activity", title: entity.title, meta: entity.location ?? "" }))}>Sign in to respond</Button>
          <Button variant="ghost" onClick={() => navigate(detailHref)}>View details</Button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button onClick={() => respond("accepted")} disabled={!!responding}>{responding === "accepted" ? "Joining…" : `Join ${data.inviterName}`}</Button>
          <Button variant="ghost" onClick={() => respond("maybe")} disabled={!!responding}>Maybe</Button>
          <Button variant="ghost" onClick={() => respond("declined")} disabled={!!responding}>Decline</Button>
        </div>
      )}
      <div style={{ marginTop: 14 }}>
        <button onClick={() => navigate(detailHref)} style={{ background: "none", border: "none", padding: 0, color: colors.mutedLight, fontSize: 13, textDecoration: "underline", cursor: "pointer" }}>
          View full details
        </button>
      </div>
    </section>
  );
}

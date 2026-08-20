import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchCircle, fetchCircleMembership, fetchCircleUpcoming, joinCircle, leaveCircle } from "../api";
import { AwardIcon, CalendarIcon, ClockIcon, UsersIcon } from "../components/icons";
import { Button, Card, EmptyState, PageSpinner } from "../components/ui";
import { BackLink } from "../components/BackLink";
import { ChatPanel } from "../components/ChatPanel";
import { PageTitle } from "../components/PageTitle";
import { InviteButton } from "../components/InviteButton";
import { useGuest } from "../GuestContext";
import { colors, fonts } from "../theme";
import type { Circle } from "../types";

// Circle detail (Tier 1) — Circles.tsx was list-only; fetchCircleUpcoming()
// already existed server-side with nowhere to render it, which was the
// whole point of a Circle ("what's coming up"), not just a member count.

export function CircleDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [circle, setCircle] = useState<Circle | null>(null);
  const [upcoming, setUpcoming] = useState<{ id: string; activityLabel: string; date: string; time: string }[]>([]);
  const [isMember, setIsMember] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = () => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      fetchCircle(id),
      fetchCircleUpcoming(id),
      resident ? fetchCircleMembership(id).then((m) => m.member) : Promise.resolve(false),
    ])
      .then(([c, up, member]) => {
        setCircle(c);
        setUpcoming(up);
        setIsMember(member);
      })
      .catch(() => setCircle(null))
      .finally(() => setLoading(false));
  };

  useEffect(load, [id, resident]);

  const handleToggleMembership = async () => {
    if (!id) return;
    setBusy(true);
    try {
      if (isMember) await leaveCircle(id);
      else await joinCircle(id);
      load();
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <PageSpinner />;
  if (!circle) {
    return (
      <section style={{ maxWidth: 640, margin: "0 auto", padding: "60px 24px", textAlign: "center" }}>
        <p style={{ color: colors.mutedLight }}>This circle doesn't exist.</p>
        <Button onClick={() => navigate("/circles")}>Back to circles</Button>
      </section>
    );
  }

  return (
    <div style={{ animation: "fadeUp .3s ease both" }}>
      <section style={{ maxWidth: 700, margin: "0 auto", padding: "26px 24px 80px" }}>
        <BackLink onClick={() => navigate("/circles")}>All circles</BackLink>

        <Card style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <PageTitle level="section" style={{ margin: "0 0 4px" }}>{circle.name}</PageTitle>
              <div style={{ color: colors.mutedLight, fontSize: 14.5 }}>
                {[circle.activityLabel, circle.area, circle.county].filter(Boolean).join(" · ") || "General"}
              </div>
              {circle.hostName && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: colors.mutedLight, fontSize: 13.5, marginTop: 4 }}>
                  Started by {circle.hostName}
                  {circle.hostVerified && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: 999, padding: "2px 8px" }}>
                      <AwardIcon size={11} /> Verified Host
                    </span>
                  )}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flex: "none" }}>
              {resident && (
                <Button variant={isMember ? "ghost" : "primary"} onClick={handleToggleMembership} disabled={busy}>
                  {isMember ? "Leave circle" : "Join circle"}
                </Button>
              )}
              <InviteButton title={circle.name} text={`Join the "${circle.name}" circle on HelloCircle`} />
            </div>
          </div>
          {circle.about && <p style={{ margin: "16px 0 0", color: "#3B423C", fontSize: 15, lineHeight: 1.55 }}>{circle.about}</p>}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 16, fontSize: 13.5, color: colors.muted }}>
            <UsersIcon size={14} /> {circle.members} member{circle.members === 1 ? "" : "s"}
          </div>
          {!resident && (
            <p style={{ fontSize: 12.5, color: colors.faint, marginTop: 10 }}>
              <button onClick={() => navigate("/bookings")} style={{ background: "none", border: "none", padding: 0, color: colors.greenText, fontWeight: 700, cursor: "pointer" }}>
                Sign in
              </button>{" "}
              to join.
            </p>
          )}
        </Card>

        <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 19, margin: "0 0 12px", letterSpacing: "-.01em" }}>
          Coming up
        </h2>
        {upcoming.length === 0 ? (
          <EmptyState icon={<CalendarIcon size={18} />} title="Nothing scheduled yet" subtitle={`Games tagged "${circle.activityLabel || "this activity"}" will show up here.`} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {upcoming.map((g) => (
              <button
                key={g.id}
                onClick={() => navigate(`/games/${g.id}`)}
                style={{ textAlign: "left", background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 14, padding: "14px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <span style={{ fontWeight: 700 }}>{g.activityLabel}</span>
                <span style={{ display: "flex", gap: 12, color: colors.mutedLight, fontSize: 13.5 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><CalendarIcon size={13} /> {g.date}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><ClockIcon size={13} /> {g.time}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {resident && isMember && (
          <div style={{ marginTop: 24 }}>
            <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 19, margin: "0 0 12px", letterSpacing: "-.01em" }}>
              Chat
            </h2>
            <ChatPanel scopeType="circle" scopeId={circle.id} residentId={resident.id} />
          </div>
        )}
      </section>
    </div>
  );
}

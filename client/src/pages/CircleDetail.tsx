import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  closeCirclePoll,
  createCirclePoll,
  fetchCircle,
  fetchCircleMembership,
  fetchCirclePolls,
  fetchCircleUpcoming,
  inviteToCircle,
  joinCircle,
  leaveCircle,
  setCircleStatus,
  voteOnCirclePollOption,
} from "../api";
import { AwardIcon, CalendarIcon, ClockIcon, PlusIcon, UsersIcon } from "../components/icons";
import { Button, Card, ConfirmDialog, EmptyState, inputStyle, labelStyle, PageSpinner } from "../components/ui";
import { BackLink } from "../components/BackLink";
import { ChatPanel } from "../components/ChatPanel";
import { PageTitle } from "../components/PageTitle";
import { InviteButton } from "../components/InviteButton";
import { ResidentPicker } from "../components/ResidentPicker";
import { useGuest } from "../GuestContext";
import { colors, fonts } from "../theme";
import type { Circle, CirclePoll } from "../types";

// Circle planning / availability poll (IA spec §10) — any member proposes
// date/time options, others vote for every option they're available for;
// the "recommended" option is just whichever has the most votes, derived
// here rather than stored.
function PollCard({ poll, isOrganiser, onVote, onClose }: { poll: CirclePoll; isOrganiser: boolean; onVote: (optionId: number) => void; onClose: () => void }) {
  const maxVotes = Math.max(0, ...poll.options.map((o) => o.voteCount));
  return (
    <Card style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5 }}>{poll.question}</div>
        {poll.status === "open" ? (
          <span style={{ fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: 999, padding: "2px 8px", flex: "none" }}>Open</span>
        ) : (
          <span style={{ fontSize: 11, fontWeight: 700, color: colors.muted, background: colors.panel, borderRadius: 999, padding: "2px 8px", flex: "none" }}>Closed</span>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
        {poll.options.map((o) => {
          const isRecommended = poll.status === "closed" && o.voteCount === maxVotes && maxVotes > 0;
          return (
            <button
              key={o.id}
              onClick={() => poll.status === "open" && onVote(o.id)}
              disabled={poll.status !== "open"}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left",
                border: `1px solid ${o.votedByMe ? colors.green : colors.border}`,
                background: o.votedByMe ? colors.greenBg : "#fff",
                borderRadius: 10, padding: "9px 12px", cursor: poll.status === "open" ? "pointer" : "default",
              }}
            >
              <span style={{ fontSize: 13.5 }}>
                {o.date}{o.time ? ` · ${o.time}` : ""} {isRecommended && <strong style={{ color: colors.greenText }}> · Recommended</strong>}
              </span>
              <span style={{ fontSize: 12, color: colors.mutedLight, fontWeight: 700 }}>{o.voteCount} vote{o.voteCount === 1 ? "" : "s"}</span>
            </button>
          );
        })}
      </div>
      {isOrganiser && poll.status === "open" && (
        <div style={{ marginTop: 10 }}>
          <Button variant="ghost" onClick={onClose}>Close poll</Button>
        </div>
      )}
    </Card>
  );
}

// Circle detail (Tier 1) — Circles.tsx was list-only; fetchCircleUpcoming()
// already existed server-side with nowhere to render it, which was the
// whole point of a Circle ("what's coming up"), not just a member count.

export function CircleDetail() {
  // Slugs (master-prompt punch list #1) — see CentreDetail.tsx's own
  // comment; every sub-resource call below uses circle.id once loaded,
  // never this raw param.
  const { id: idOrSlug } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [circle, setCircle] = useState<Circle | null>(null);
  const [upcoming, setUpcoming] = useState<{ id: string; activityLabel: string; date: string; time: string }[]>([]);
  const [isMember, setIsMember] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [polls, setPolls] = useState<CirclePoll[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [pollOpen, setPollOpen] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollDates, setPollDates] = useState(["", "", ""]);

  const isOrganiser = role === "organiser";

  const load = () => {
    if (!idOrSlug) return;
    setLoading(true);
    fetchCircle(idOrSlug)
      .then(async (c) => {
        setCircle(c);
        const [up, membership, p] = await Promise.all([
          fetchCircleUpcoming(c.id),
          resident ? fetchCircleMembership(c.id) : Promise.resolve({ member: false, role: null }),
          fetchCirclePolls(c.id).catch(() => []),
        ]);
        setUpcoming(up);
        setIsMember(membership.member);
        setRole(membership.role);
        setPolls(p);
      })
      .catch(() => setCircle(null))
      .finally(() => setLoading(false));
  };

  useEffect(load, [idOrSlug, resident]);

  const handleCloseCircle = async () => {
    if (!circle) return;
    await setCircleStatus(circle.id, "closed");
    setConfirmingClose(false);
    load();
  };

  const handleInvite = async (residentId: string) => {
    if (!circle) return;
    setInviteError(null);
    try {
      await inviteToCircle(circle.id, residentId);
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : "Couldn't send that invite");
    }
  };

  const handleCreatePoll = async () => {
    if (!circle || !pollQuestion.trim()) return;
    const options = pollDates.filter(Boolean).map((date) => ({ date }));
    if (options.length === 0) return;
    await createCirclePoll(circle.id, { question: pollQuestion.trim(), options });
    setPollQuestion("");
    setPollDates(["", "", ""]);
    setPollOpen(false);
    load();
  };

  const handleToggleMembership = async () => {
    if (!circle) return;
    setBusy(true);
    try {
      if (isMember) await leaveCircle(circle.id);
      else await joinCircle(circle.id);
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
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <PageTitle level="section" style={{ margin: "0 0 4px" }}>{circle.name}</PageTitle>
                {circle.status === "closed" && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: colors.muted, background: colors.panel, borderRadius: 999, padding: "2px 9px" }}>Closed</span>
                )}
              </div>
              <div style={{ color: colors.mutedLight, fontSize: 14.5 }}>
                {[circle.activityLabel, circle.area, circle.county].filter(Boolean).join(" · ") || "General"}
              </div>
              {circle.hostName && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: colors.mutedLight, fontSize: 13.5, marginTop: 4 }}>
                  Started by{" "}
                  {circle.hostVerified ? (
                    <button onClick={() => navigate(`/host/${circle.createdByResidentId}`)} style={{ background: "none", border: "none", padding: 0, color: colors.text, font: "inherit", cursor: "pointer", textDecoration: "underline" }}>
                      {circle.hostName}
                    </button>
                  ) : (
                    circle.hostName
                  )}
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

          {isOrganiser && circle.status === "active" && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${colors.border}` }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: colors.muted, marginBottom: 8 }}>ORGANISER</div>
              <div style={{ marginBottom: 8 }}>
                <ResidentPicker onInvite={handleInvite} />
              </div>
              {inviteError && <p style={{ fontSize: 12.5, color: colors.danger, margin: "0 0 8px" }}>{inviteError}</p>}
              <button onClick={() => setConfirmingClose(true)} style={{ background: "none", border: "none", padding: 0, color: colors.danger, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                Close this circle
              </button>
            </div>
          )}
        </Card>

        <ConfirmDialog
          open={confirmingClose}
          title="Close this circle?"
          message="It drops off public browse but stays visible to members — this can't be undone from here."
          confirmLabel="Close circle"
          onConfirm={handleCloseCircle}
          onCancel={() => setConfirmingClose(false)}
        />

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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 19, margin: 0, letterSpacing: "-.01em" }}>Planning</h2>
              {!pollOpen && (
                <Button variant="ghost" onClick={() => setPollOpen(true)}>
                  <PlusIcon size={14} /> Propose a time
                </Button>
              )}
            </div>
            {pollOpen && (
              <Card style={{ marginBottom: 14 }}>
                <label style={labelStyle}>What are you planning?</label>
                <input value={pollQuestion} onChange={(e) => setPollQuestion(e.target.value)} placeholder="e.g. Next badminton session" style={{ ...inputStyle, marginBottom: 10 }} />
                <label style={labelStyle}>Date options</label>
                {pollDates.map((d, i) => (
                  <input
                    key={i}
                    type="date"
                    value={d}
                    onChange={(e) => setPollDates((ds) => ds.map((x, idx) => (idx === i ? e.target.value : x)))}
                    style={{ ...inputStyle, marginBottom: 6, maxWidth: 200 }}
                  />
                ))}
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <Button onClick={handleCreatePoll} disabled={!pollQuestion.trim()}>Create poll</Button>
                  <Button variant="ghost" onClick={() => setPollOpen(false)}>Cancel</Button>
                </div>
              </Card>
            )}
            {polls.length === 0 && !pollOpen ? (
              <EmptyState icon={<CalendarIcon size={18} />} title="Nothing being planned yet" subtitle="Propose a few dates and let the circle vote on what works." />
            ) : (
              polls.map((p) => (
                <PollCard
                  key={p.id}
                  poll={p}
                  isOrganiser={isOrganiser}
                  onVote={(optionId) => voteOnCirclePollOption(circle.id, p.id, optionId).then(load)}
                  onClose={() => closeCirclePoll(circle.id, p.id).then(load)}
                />
              ))
            )}

            <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 19, margin: "24px 0 12px", letterSpacing: "-.01em" }}>
              Chat
            </h2>
            <ChatPanel scopeType="circle" scopeId={circle.id} residentId={resident.id} />
          </div>
        )}
      </section>
    </div>
  );
}

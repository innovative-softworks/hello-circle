import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { signInHref } from "../authRedirect";
import { trackEvent } from "../analytics";
import { CheckIcon, PlusIcon } from "./icons";
import { ResidentPicker } from "./ResidentPicker";
import { ShareButton } from "./ShareButton";
import { ActionMenu } from "./ActionMenu";
import { Button, Card, ConfirmDialog } from "./ui";
import { colors, fonts, radius } from "../theme";
import type { Circle } from "../types";

// Right-rail Join card (reference §21-22) — the single strongest CTA on the
// page, state-aware per the reference's own state table. Circle join modes
// (Follow/Notify/Stats gap audit §6) added real "invite-only"/"requested"
// states on top of the original open/closed model — see routes/circles.ts's
// join-mode comment for the full server-side state machine. Organiser
// management (create plan / invite / close) previously lived in a
// full-bleed CTA band; it's real functionality, just relocated here behind
// "Manage Circle" so it isn't lost in the restructure.

// "restricted" — Circle Experience 2.0, owner decision D5: an organiser removed
// this person; they can't rejoin or ask again until an organiser lifts it.
export type JoinState = "closed" | "organiser" | "signed-out" | "member" | "available" | "requested" | "invite-only" | "invited" | "restricted";

interface Props {
  circle: Circle;
  state: JoinState;
  busy: boolean;
  /** For an approval Circle, the request carries an optional note and answers (Booking UX Phase 5). */
  onJoin: (request?: { note?: string; answers?: string[] }) => void;
  onLeave: () => void;
  onMessage: () => void;
  onCreatePlan: () => void;
  onInvite: (residentId: string) => Promise<void>;
  inviteError: string | null;
  onRequestClose: () => void;
  /** Circle Experience 4.0 visitor page: just the status and the action, no card. */
  bare?: boolean;
  /** Back from sign-in with ?join=1 — open the join step straight away. */
  autoJoin?: boolean;
  onAutoJoinHandled?: () => void;
  /** Bumped by other "Join" buttons on the visitor page to start the same flow. */
  joinSignal?: number;
  /** Visitor page wording for the signed-out button. */
  signedOutLabel?: string;
}

export function CircleJoinCard({ circle, state, busy, onJoin, onLeave, onMessage, onCreatePlan, onInvite, inviteError, onRequestClose, bare, autoJoin, onAutoJoinHandled, joinSignal, signedOutLabel }: Props) {
  const navigate = useNavigate();
  // Signed out: remember the intent (?join=1) so the join step opens on return.
  const signIn = () => {
    trackEvent("circle_join_clicked", { circleId: circle.id, signedIn: false });
    const url = new URL(window.location.href);
    url.searchParams.set("join", "1");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    navigate(
      signInHref({
        kind: "circle",
        title: circle.name,
        meta: `${circle.members.toLocaleString()} member${circle.members === 1 ? "" : "s"} · ${circle.area}, ${circle.county}`,
      })
    );
  };
  const startJoin = () => {
    trackEvent("circle_join_clicked", { circleId: circle.id, signedIn: true, mode: circle.joinMode });
    setJoinConfirmOpen(true);
  };
  const [managing, setManaging] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [joinConfirmOpen, setJoinConfirmOpen] = useState(false);
  const [note, setNote] = useState("");
  const questions = circle.joinMode === "approval" ? circle.joinQuestions ?? [] : [];
  const [answers, setAnswers] = useState<string[]>([]);
  useEffect(() => {
    if (!autoJoin) return;
    if (state === "available") setJoinConfirmOpen(true);
    onAutoJoinHandled?.();
  }, [autoJoin, state, onAutoJoinHandled]);
  useEffect(() => {
    if (!joinSignal) return;
    if (state === "available") startJoin();
    else if (state === "signed-out") signIn();
    else if (state === "invited") onJoin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinSignal]);

  const leaveDialog = (
    <ConfirmDialog
      open={leaveConfirmOpen}
      title={`Leave ${circle.name}?`}
      message="You'll stop seeing this Circle's plans and lose your spot in any you've joined."
      confirmLabel="Leave Circle"
      cancelLabel="Stay in"
      busy={busy}
      onConfirm={() => {
        onLeave();
        setLeaveConfirmOpen(false);
      }}
      onCancel={() => setLeaveConfirmOpen(false)}
    />
  );

  // Circle Home reference layout (2026-10-23): a member's card leads with the
  // next activity; Message Circle beside it, Leave behind the "…" menu.
  if (state === "member") {
    return (
      <div className="ch-card ch-member-card">
        <div className="ch-member-head">
          <span className="ch-check" aria-hidden="true">
            <CheckIcon size={16} />
          </span>
          <div>
            <strong>You're a member</strong>
            <span>Welcome! You're part of this Circle and you'll hear about every plan.</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {circle.nextPlan && (
            <Button full onClick={() => navigate(`/games/${circle.nextPlan!.id}`)}>
              {circle.nextPlan.source === "circle" ? "View next activity" : "View similar activity"}
            </Button>
          )}
          <div className="ch-member-actions">
            <Button variant="ghost" onClick={onMessage} style={{ width: "100%" }}>
              Message Circle
            </Button>
            <ActionMenu label={`Membership options for ${circle.name}`} appearance="icon" items={[{ label: "Leave Circle", danger: true, onSelect: () => setLeaveConfirmOpen(true), disabled: busy }]} />
          </div>
        </div>
        {!!circle.familiarMembers && (
          <p style={{ margin: "12px 0 0", fontSize: 12.5, color: colors.muted }}>
            {circle.familiarMembers} {circle.familiarMembers === 1 ? "person" : "people"} you've played with before {circle.familiarMembers === 1 ? "is" : "are"} here.
          </p>
        )}
        {leaveDialog}
      </div>
    );
  }

  const Wrap = bare ? BareWrap : Card;
  const showIntro = !bare || !(state === "available" || state === "signed-out");
  return (
    <Wrap>
      {showIntro && (
        <>
      <h3 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: bare ? 16 : 18, margin: "0 0 6px", letterSpacing: 0 }}>
        {state === "organiser"
          ? "Manage this Circle"
          : state === "requested"
          ? "Request sent"
          : state === "invited"
          ? "You're invited"
          : state === "invite-only"
          ? "Invite only"
          : state === "restricted"
          ? "You can't rejoin this Circle"
          : `Join ${circle.name}`}
      </h3>
      <p style={{ margin: "0 0 16px", fontSize: 13.5, color: colors.mutedLight, lineHeight: 1.5 }}>
        {state === "closed"
          ? "This Circle is closed to new activity."
          : state === "requested"
          ? "The organiser will let you know when they respond."
          : state === "invited"
          ? `The organiser has invited you to join ${circle.name}.`
          : state === "invite-only"
          ? "The organiser adds members by invite."
          : state === "restricted"
          ? "An organiser removed you from this Circle. Only an organiser can change that — if you think it's a mistake, contact them or report the Circle."
          : `Be part of our active and friendly ${circle.activityLabel.toLowerCase()} community.`}
      </p>
        </>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {state === "closed" && (
          <div style={{ fontWeight: 700, fontSize: 13.5, color: colors.muted, background: colors.panel, borderRadius: radius.control, padding: "10px 14px", textAlign: "center" }}>
            Closed to new activity
          </div>
        )}

        {state === "signed-out" && (
          <Button full onClick={signIn}>
            {signedOutLabel ?? (bare ? "Join this Circle" : "Sign in to join")}
          </Button>
        )}

        {state === "available" && (
          <Button full onClick={startJoin} disabled={busy}>
            {busy ? "…" : circle.joinMode === "approval" ? "Request to join" : "Join Circle"}
          </Button>
        )}

        {state === "invited" && (
          <Button full onClick={() => onJoin()} disabled={busy}>
            {busy ? "…" : "Accept invite"}
          </Button>
        )}

        {state === "requested" && (
          <>
            <div style={{ fontWeight: 700, fontSize: 13.5, color: colors.muted, background: colors.panel, borderRadius: radius.control, padding: "10px 14px", textAlign: "center" }}>
              Waiting on the organiser
            </div>
            <Button variant="ghost" full onClick={onLeave} disabled={busy}>{busy ? "…" : "Withdraw request"}</Button>
          </>
        )}

        {state === "invite-only" && (
          <div style={{ fontWeight: 700, fontSize: 13.5, color: colors.muted, background: colors.panel, borderRadius: radius.control, padding: "10px 14px", textAlign: "center" }}>
            Ask the organiser for an invite
          </div>
        )}

        {state === "organiser" && (
          <>
            {!managing ? (
              <Button full onClick={() => setManaging(true)}>Manage Circle</Button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <Button full onClick={onCreatePlan}><PlusIcon size={14} /> Create plan</Button>
                <Button variant="ghost" full onClick={() => navigate(`/manage/circles/${circle.slug ?? circle.id}`)}>Manage circle</Button>
                <Button variant="ghost" full onClick={onMessage}>Message Circle</Button>
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: colors.mutedLight, textTransform: "uppercase", letterSpacing: 0, marginBottom: 8 }}>Invite someone</div>
                  <ResidentPicker onInvite={onInvite} />
                  {inviteError && <p style={{ fontSize: 12, color: colors.danger, margin: "6px 0 0" }}>{inviteError}</p>}
                </div>
                {circle.status === "active" && (
                  <button onClick={onRequestClose} style={{ background: "none", border: "none", padding: 0, color: colors.danger, fontSize: 12.5, fontWeight: 700, cursor: "pointer", textAlign: "left" }}>
                    Close this circle
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {!bare && (state === "available" || state === "signed-out") && (
        <div style={{ marginTop: 10 }}>
          <ShareButton entityType="circle" entityId={circle.id} />
        </div>
      )}

      {!bare && (state !== "closed" || !!circle.familiarMembers) && !(circle.restricted && circle.joinMode === "invite") && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${colors.border}`, fontSize: 13, color: colors.mutedLight }}>
          {circle.familiarMembers
            ? `${circle.familiarMembers} ${circle.familiarMembers === 1 ? "person" : "people"} you've played with before ${circle.familiarMembers === 1 ? "is" : "are"} here.`
            : `${circle.members.toLocaleString()} member${circle.members === 1 ? "" : "s"}.`}
        </div>
      )}

      {leaveDialog}

      <ConfirmDialog
        open={joinConfirmOpen}
        title={circle.joinMode === "approval" ? `Request to join ${circle.name}?` : `Join ${circle.name}?`}
        message={
          circle.joinMode === "approval"
            ? "The organiser will need to approve your request before you're a member."
            : `You'll be part of ${circle.name} and hear about every plan.`
        }
        confirmLabel={circle.joinMode === "approval" ? "Send request" : "Join Circle"}
        cancelLabel="Not now"
        tone="neutral"
        busy={busy}
        onConfirm={() => {
          onJoin(circle.joinMode === "approval" ? { note: note.trim() || undefined, answers: questions.map((_, i) => (answers[i] ?? "").trim()) } : undefined);
          setJoinConfirmOpen(false);
        }}
        onCancel={() => setJoinConfirmOpen(false)}
      >
        {circle.joinMode === "approval" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {questions.map((q, i) => (
              <div key={q}>
                <label htmlFor={`circle-q-${i}`} style={{ display: "block", fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 6 }}>
                  {q} <span style={{ fontWeight: 400, color: colors.muted }}>(optional)</span>
                </label>
                <input
                  id={`circle-q-${i}`}
                  value={answers[i] ?? ""}
                  maxLength={500}
                  onChange={(e) => setAnswers((a) => Object.assign([...a], { [i]: e.target.value }))}
                  style={{ width: "100%", boxSizing: "border-box", minHeight: 44, padding: "10px 12px", fontSize: 16, border: `1px solid ${colors.inputBorder}`, borderRadius: radius.control, background: colors.surface, color: colors.text }}
                />
              </div>
            ))}
            <div>
              <label htmlFor="circle-request-note" style={{ display: "block", fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 6 }}>
                A note for the organiser <span style={{ fontWeight: 400, color: colors.muted }}>(optional)</span>
              </label>
              <textarea
                id="circle-request-note"
                value={note}
                maxLength={500}
                rows={3}
                onChange={(e) => setNote(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: 16, border: `1px solid ${colors.inputBorder}`, borderRadius: radius.control, background: colors.surface, color: colors.text, resize: "vertical" }}
              />
            </div>
          </div>
        )}
      </ConfirmDialog>
    </Wrap>
  );
}

function BareWrap({ children }: { children: React.ReactNode }) {
  return <div className="cv-join-bare">{children}</div>;
}

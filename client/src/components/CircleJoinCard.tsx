import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signInHref } from "../authRedirect";
import { CheckIcon, PlusIcon } from "./icons";
import { InviteButton } from "./InviteButton";
import { ResidentPicker } from "./ResidentPicker";
import { Button, Card } from "./ui";
import { colors, fonts, radius } from "../theme";
import type { Circle } from "../types";

// Right-rail Join card (reference §21-22) — the single strongest CTA on the
// page, state-aware per the reference's own state table. This app's Circle
// model only has active/closed status, no privacy/request-to-join concept
// (see routes/circles.ts), so "Private"/"Request to join"/"Pending" states
// from the reference are deliberately not implemented — faking them would
// invent product behaviour that doesn't exist. Organiser management
// (create plan / invite / close) previously lived in a full-bleed CTA band;
// it's real functionality, just relocated here behind "Manage Circle" so it
// isn't lost in the restructure.

export type JoinState = "closed" | "organiser" | "signed-out" | "member" | "available";

interface Props {
  circle: Circle;
  state: JoinState;
  busy: boolean;
  onJoin: () => void;
  onLeave: () => void;
  onMessage: () => void;
  onCreatePlan: () => void;
  onInvite: (residentId: string) => Promise<void>;
  inviteError: string | null;
  onRequestClose: () => void;
}

export function CircleJoinCard({ circle, state, busy, onJoin, onLeave, onMessage, onCreatePlan, onInvite, inviteError, onRequestClose }: Props) {
  const navigate = useNavigate();
  const [managing, setManaging] = useState(false);

  return (
    <Card>
      <h3 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 18, margin: "0 0 6px", letterSpacing: "-.01em" }}>
        {state === "member" ? "You're in" : state === "organiser" ? "Manage this Circle" : `Join ${circle.name}`}
      </h3>
      <p style={{ margin: "0 0 16px", fontSize: 13.5, color: colors.mutedLight, lineHeight: 1.5 }}>
        {state === "closed"
          ? "This Circle is closed to new activity."
          : state === "member"
          ? `Be part of ${circle.name} — you'll hear about every plan.`
          : `Be part of our active and friendly ${circle.activityLabel.toLowerCase()} community.`}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {state === "closed" && (
          <div style={{ fontWeight: 700, fontSize: 13.5, color: colors.muted, background: colors.panel, borderRadius: radius.control, padding: "10px 14px", textAlign: "center" }}>
            Closed to new activity
          </div>
        )}

        {state === "signed-out" && (
          <Button
            full
            onClick={() =>
              navigate(
                signInHref({
                  kind: "circle",
                  title: circle.name,
                  meta: `${circle.members.toLocaleString()} member${circle.members === 1 ? "" : "s"} · ${circle.area}, ${circle.county}`,
                })
              )
            }
          >
            Sign in to join
          </Button>
        )}

        {state === "available" && (
          <Button full onClick={onJoin} disabled={busy}>{busy ? "Joining…" : "Join Circle"}</Button>
        )}

        {state === "member" && (
          <>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 14, color: colors.greenText, background: colors.greenBg, borderRadius: radius.control, padding: "10px 14px", justifyContent: "center" }}>
              <CheckIcon size={14} /> Joined
            </div>
            {circle.nextPlan && (
              <Button full onClick={() => navigate(`/games/${circle.nextPlan!.id}`)}>View next plan</Button>
            )}
            <Button variant="ghost" full onClick={onMessage}>Message Circle</Button>
            <Button variant="ghost" full onClick={onLeave} disabled={busy}>{busy ? "…" : "Leave Circle"}</Button>
          </>
        )}

        {state === "organiser" && (
          <>
            {!managing ? (
              <Button full onClick={() => setManaging(true)}>Manage Circle</Button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <Button full onClick={onCreatePlan}><PlusIcon size={14} /> Create plan</Button>
                <Button variant="ghost" full onClick={onMessage}>Message Circle</Button>
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: colors.mutedLight, textTransform: "uppercase", letterSpacing: ".03em", marginBottom: 8 }}>Invite someone</div>
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

      {(state === "available" || state === "signed-out") && (
        <div style={{ marginTop: 10 }}>
          <InviteButton title={circle.name} text={`Join the "${circle.name}" circle on HelloCircle`} listingType="circle" listingId={circle.id} />
        </div>
      )}

      {(state !== "closed" || !!circle.familiarMembers) && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${colors.border}`, fontSize: 13, color: colors.mutedLight }}>
          {circle.familiarMembers
            ? `${circle.familiarMembers} ${circle.familiarMembers === 1 ? "person" : "people"} you've played with before ${circle.familiarMembers === 1 ? "is" : "are"} here.`
            : `${circle.members.toLocaleString()} member${circle.members === 1 ? "" : "s"}.`}
        </div>
      )}
    </Card>
  );
}

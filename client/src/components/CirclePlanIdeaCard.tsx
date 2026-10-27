import { useNavigate } from "react-router-dom";
import { CalendarIcon, PinIcon, UsersIcon } from "./icons";
import { Button, Card } from "./ui";
import { colors, fonts, radius } from "../theme";
import type { CirclePlanIdea } from "../types";
import { dateLabel } from "../euro";

// Phase 2 "Circles V2" — see CirclePlanIdea's own comment in types.ts for
// why this is named "PlanIdea" and not reusing the pre-existing
// CirclePlanCard (that one renders the fuzzy activity-label-matched
// "upcoming" rows — a completely different concept this file never
// touches). Status is always shown in human language (brief §67 — never a
// raw "STATUS: ACTIVITY_CREATED"-style label).
//
// Circle Experience 2.0, Make It Happen — when the server sends interest
// (`stage`/`interestCount`, only while circles.make_it_happen is on) the card
// also shows "N of target in", an "I'm in" toggle, and the derived stage.
// Interest is never a booking: the organiser still confirms, then creates
// the activity through the normal activity form.

const STATUS_LABEL: Record<CirclePlanIdea["status"], { label: string; fg: string; bg: string }> = {
  idea: { label: "Idea", fg: colors.text, bg: colors.panel },
  confirmed: { label: "Confirmed", fg: colors.greenText, bg: colors.greenBg },
  activity_created: { label: "Activity ready", fg: colors.greenText, bg: colors.greenBg },
  completed: { label: "Completed", fg: colors.mutedLight, bg: colors.panel },
  cancelled: { label: "Cancelled", fg: colors.mutedLight, bg: colors.panel },
};

const STAGE_LABEL: Record<NonNullable<CirclePlanIdea["stage"]>, { label: string; fg: string; bg: string }> = {
  gathering: { label: "Gathering interest", fg: colors.text, bg: colors.panel },
  ready: { label: "Ready for review", fg: colors.orangeDark, bg: colors.orangeBg },
  confirmed: { label: "Confirmed — activity coming", fg: colors.greenText, bg: colors.greenBg },
  activity_created: { label: "It's happening", fg: colors.greenText, bg: colors.greenBg },
  completed: { label: "Completed", fg: colors.mutedLight, bg: colors.panel },
  cancelled: { label: "Declined", fg: colors.mutedLight, bg: colors.panel },
  expired: { label: "Stopped gathering interest", fg: colors.mutedLight, bg: colors.panel },
};

export function CirclePlanIdeaCard({
  plan,
  isOrganiser,
  isCreator,
  onConfirm,
  onCancel,
  busy,
  onToggleInterest,
  interestBusy,
  closed,
}: {
  plan: CirclePlanIdea;
  isOrganiser: boolean;
  isCreator: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
  /** Only passed while Make It Happen is on. */
  onToggleInterest?: () => void;
  interestBusy?: boolean;
  closed?: boolean;
}) {
  const navigate = useNavigate();
  const activityCancelled = plan.activity?.status === "cancelled";
  const status = plan.stage ? STAGE_LABEL[plan.stage] : STATUS_LABEL[plan.status];
  const when = [plan.proposedDate ? dateLabel(plan.proposedDate) : null, plan.proposedTime].filter(Boolean).join(" · ");
  const target = plan.targetSize ?? 3;
  const showInterest = typeof plan.interestCount === "number";
  const gathering = plan.stage === "gathering" || plan.stage === "ready" || plan.stage === "confirmed";

  const createActivityHref =
    `/games/host?activity=${encodeURIComponent(plan.title)}&circleId=${plan.circleId}&planId=${plan.id}` +
    (plan.proposedDate ? `&date=${plan.proposedDate}` : "") +
    (plan.proposedTime ? `&time=${plan.proposedTime}` : "") +
    (plan.locationText ? `&locationText=${encodeURIComponent(plan.locationText)}` : "") +
    (plan.interestCount ? `&capacity=${Math.max(plan.interestCount, plan.targetSize ?? 0)}` : "");

  return (
    <Card style={{ marginBottom: 10 }}>
      <div id={`plan-${plan.id}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, scrollMarginTop: 100 }}>
        <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15 }}>{plan.title}</div>
        <span style={{ fontSize: 11, fontWeight: 700, color: status.fg, background: status.bg, borderRadius: radius.pill, padding: "2px 8px", flex: "none", whiteSpace: "nowrap" }}>
          {activityCancelled ? "Activity cancelled" : status.label}
        </span>
      </div>
      <div style={{ fontSize: 12, color: colors.mutedLight, marginTop: 3 }}>Suggested by {plan.createdByName}</div>
      {(when || plan.locationText) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8, fontSize: 12.5, color: colors.muted }}>
          {when && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <CalendarIcon size={13} /> {when}
            </span>
          )}
          {plan.locationText && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <PinIcon size={13} /> {plan.locationText}
            </span>
          )}
        </div>
      )}
      {plan.note && <p style={{ fontSize: 13, color: colors.muted, margin: "8px 0 0" }}>{plan.note}</p>}
      {plan.stage === "cancelled" && plan.declineReason && <p style={{ fontSize: 13, color: colors.muted, margin: "8px 0 0" }}>Organiser: {plan.declineReason}</p>}

      {showInterest && plan.stage !== "cancelled" && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700 }}>
            <UsersIcon size={13} /> {plan.interestCount} {plan.interestCount === 1 ? "is" : "are"} in{gathering && plan.stage !== "confirmed" ? ` · ${target} makes it worth doing` : ""}
          </div>
          {gathering && plan.stage !== "confirmed" && (
            <div className="ce-meter" aria-hidden="true">
              <span style={{ width: `${Math.min(100, Math.round(((plan.interestCount ?? 0) / target) * 100))}%` }} />
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {onToggleInterest && gathering && !closed && (
          <Button variant={plan.interestedByMe ? "ghost" : "primary"} onClick={onToggleInterest} disabled={interestBusy} aria-pressed={!!plan.interestedByMe}>
            {interestBusy ? "…" : plan.interestedByMe ? "I'm in · withdraw" : "I'm in"}
          </Button>
        )}
        {plan.status === "idea" && plan.stage !== "expired" && isOrganiser && (
          <Button variant={onToggleInterest ? "ghost" : "primary"} onClick={onConfirm} disabled={busy}>
            {busy ? "…" : "Confirm plan"}
          </Button>
        )}
        {plan.status === "idea" && (isOrganiser || isCreator) && (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {isOrganiser && !isCreator && onToggleInterest ? "Decline" : "Cancel"}
          </Button>
        )}
        {plan.status === "confirmed" && isOrganiser && (
          <>
            <Button
              onClick={() => navigate(createActivityHref)}
            >
              Create activity
            </Button>
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          </>
        )}
        {plan.activity && (plan.status === "activity_created" || plan.status === "completed") && !activityCancelled && (
          <Button variant="ghost" onClick={() => navigate(`/games/${plan.activity!.id}`)}>
            View activity →
          </Button>
        )}
      </div>
      {plan.status === "confirmed" && isOrganiser && (
        <p style={{ fontSize: 12, color: colors.mutedLight, margin: "8px 0 0" }}>Next: set the venue, time and places in the activity form. Nothing is booked until you publish it.</p>
      )}
    </Card>
  );
}

import { useNavigate } from "react-router-dom";
import { CalendarIcon, PinIcon } from "./icons";
import { Button, Card } from "./ui";
import { colors, fonts, radius } from "../theme";
import type { CirclePlanIdea } from "../types";

// Phase 2 "Circles V2" — see CirclePlanIdea's own comment in types.ts for
// why this is named "PlanIdea" and not reusing the pre-existing
// CirclePlanCard (that one renders the fuzzy activity-label-matched
// "upcoming" rows — a completely different concept this file never
// touches). Status is always shown in human language (brief §67 — never a
// raw "STATUS: ACTIVITY_CREATED"-style label).

const STATUS_LABEL: Record<CirclePlanIdea["status"], { label: string; fg: string; bg: string }> = {
  idea: { label: "Idea", fg: colors.text, bg: colors.panel },
  confirmed: { label: "Confirmed", fg: colors.greenText, bg: colors.greenBg },
  activity_created: { label: "Activity ready", fg: colors.greenText, bg: colors.greenBg },
  completed: { label: "Completed", fg: colors.mutedLight, bg: colors.panel },
  cancelled: { label: "Cancelled", fg: colors.mutedLight, bg: colors.panel },
};

export function CirclePlanIdeaCard({
  plan,
  isOrganiser,
  isCreator,
  onConfirm,
  onCancel,
  busy,
}: {
  plan: CirclePlanIdea;
  isOrganiser: boolean;
  isCreator: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const navigate = useNavigate();
  const status = STATUS_LABEL[plan.status];
  const activityCancelled = plan.activity?.status === "cancelled";

  const when = [plan.proposedDate, plan.proposedTime].filter(Boolean).join(" · ");

  return (
    <Card style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
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

      {plan.status === "idea" && (isOrganiser || isCreator) && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {isOrganiser && (
            <Button onClick={onConfirm} disabled={busy}>
              {busy ? "…" : "Confirm plan"}
            </Button>
          )}
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      )}
      {plan.status === "confirmed" && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {isOrganiser && (
            <Button
              onClick={() =>
                navigate(
                  `/games/host?activity=${encodeURIComponent(plan.title)}&circleId=${plan.circleId}&planId=${plan.id}` +
                    (plan.proposedDate ? `&date=${plan.proposedDate}` : "") +
                    (plan.proposedTime ? `&time=${plan.proposedTime}` : "") +
                    (plan.locationText ? `&locationText=${encodeURIComponent(plan.locationText)}` : "")
                )
              }
            >
              Create activity
            </Button>
          )}
          {isOrganiser && (
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          )}
        </div>
      )}
      {plan.activity && (plan.status === "activity_created" || plan.status === "completed") && !activityCancelled && (
        <div style={{ marginTop: 12 }}>
          <Button variant="ghost" onClick={() => navigate(`/games/${plan.activity!.id}`)}>
            View activity →
          </Button>
        </div>
      )}
    </Card>
  );
}

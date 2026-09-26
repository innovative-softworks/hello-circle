import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { fetchNextSteps } from "../api";
import { formatDateTime } from "../formatters";
import { colors, fonts, radius } from "../theme";
import type { GameNextSteps, NextStepCircle, NextStepsKind } from "../types";
import { CalendarIcon, PlusIcon, UsersIcon } from "./icons";
import { Button } from "./ui";

// "Keep the connection going" (community participation upgrade, Releases
// 1+3) — shown after the post-activity feedback for every participation
// kind (game/booking/registration/program/experience), so the
// page doesn't end at "thanks". At most two rows: one Circle step (the
// game's own Circle, else an open one nearby for the same activity, else
// "start one") and the next session. Joining happens on the Circle's own
// page, which already handles open/approval join modes — this only points
// there. Renders nothing until loaded, and nothing if there's no step.

function Row({ icon, title, detail, action }: { icon: ReactNode; title: string; detail: string; action: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderTop: `1px solid ${colors.border}`, flexWrap: "wrap" }}>
      <div style={{ width: 36, height: 36, borderRadius: radius.pill, background: colors.greenBg, color: colors.greenText, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {icon}
      </div>
      <div style={{ flex: "1 1 160px", minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5, lineHeight: 1.3 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: colors.muted, marginTop: 2 }}>{detail}</div>
      </div>
      {action}
    </div>
  );
}

function circleHref(c: NextStepCircle) {
  return `/circles/${c.slug ?? c.id}`;
}

function membersText(n: number) {
  return `${n} ${n === 1 ? "member" : "members"}`;
}

export function NextStepsPanel({ kind, reference }: { kind: NextStepsKind; reference: string }) {
  const navigate = useNavigate();
  const [steps, setSteps] = useState<GameNextSteps | null>(null);

  useEffect(() => {
    fetchNextSteps(kind, reference)
      .then(setSteps)
      .catch(() => setSteps(null));
  }, [kind, reference]);

  if (!steps) return null;
  const circle = steps.officialCircle ?? steps.suggestedCircle;
  const { nextSession, createCircle } = steps;
  if (!circle && !nextSession && !createCircle) return null;

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".09em", color: colors.muted, marginBottom: 4 }}>
        Keep the connection going
      </div>
      <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 6px" }}>See these people again</h3>

      {circle && (
        <Row
          icon={<UsersIcon size={17} />}
          title={circle.name}
          detail={`${membersText(circle.members)} · ${steps.officialCircle ? "This session's Circle" : "A Circle for the same activity nearby"}`}
          action={
            <Button variant={circle.isMember ? "ghost" : "primary"} onClick={() => navigate(circleHref(circle))}>
              {circle.isMember ? "Open Circle" : circle.joinMode === "approval" ? "Ask to join" : "Join Circle"}
            </Button>
          }
        />
      )}

      {nextSession && (
        <Row
          icon={<CalendarIcon size={17} />}
          title={kind === "game" ? (nextSession.sameHost ? "Next session with this host" : `Next ${nextSession.title.toLowerCase()} session`) : `Next: ${nextSession.title}`}
          detail={`${formatDateTime(nextSession.date, nextSession.time)}${nextSession.centreName ? ` · ${nextSession.centreName}` : ""}${nextSession.spotsLeft !== null ? ` · ${nextSession.spotsLeft} spots left` : ""}`}
          action={
            <Button variant="ghost" onClick={() => navigate(nextSession.href)}>
              View
            </Button>
          }
        />
      )}

      {!circle && createCircle && (
        <Row
          icon={<PlusIcon size={17} />}
          title="Start a Circle"
          detail={`No ${createCircle.activityLabel ? createCircle.activityLabel.toLowerCase() + " " : ""}Circle nearby yet — start one so this group can plan the next one together.`}
          action={
            <Button
              variant="ghost"
              onClick={() => navigate(`/circles/start?activity=${encodeURIComponent(createCircle.activityLabel)}&county=${encodeURIComponent(createCircle.county)}`)}
            >
              Start one
            </Button>
          }
        />
      )}
    </div>
  );
}

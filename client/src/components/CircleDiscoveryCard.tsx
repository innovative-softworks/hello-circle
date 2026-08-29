import { useNavigate } from "react-router-dom";
import { AwardIcon, CalendarIcon, RepeatIcon, UsersIcon } from "./icons";
import { Photo } from "./Photo";
import { Button, Card } from "./ui";
import { dateLabel } from "../euro";
import { colors, fonts } from "../theme";
import type { Circle } from "../types";

const DAY_MS = 86400000;

/** Lightweight discovery-only activity state (§27) — "ACTIVE NOW" (a plan
 * within 7 days) or "NEW" (created in the last 3 weeks). Deliberately no
 * "Inactive"/"Quiet" badge — a Circle with nothing coming up just shows no
 * badge at all and ranks lower in "Recommended" sort, per the spec's own
 * explicit instruction not to label a Circle negatively on a discovery card. */
function activityState(circle: Circle): "active-now" | "new" | null {
  if (circle.nextPlan) {
    const days = (new Date(`${circle.nextPlan.date}T00:00:00`).getTime() - Date.now()) / DAY_MS;
    if (days <= 7) return "active-now";
  }
  const ageDays = (Date.now() - new Date(circle.createdAt).getTime()) / DAY_MS;
  if (ageDays <= 21) return "new";
  return null;
}

function spotsLabel(spotsLeft: number): string {
  if (spotsLeft === 0) return "Full";
  if (spotsLeft === 1) return "1 spot left";
  if (spotsLeft <= 3) return `${spotsLeft} spots left`;
  return `${spotsLeft} more welcome`;
}

export function CircleDiscoveryCard({ circle, joined, onJoin, onLeave, busy }: { circle: Circle; joined: boolean; onJoin: () => void; onLeave: () => void; busy: boolean }) {
  const navigate = useNavigate();
  const state = activityState(circle);
  const urgent = !!circle.nextPlan && circle.nextPlan.spotsLeft <= 3;
  const open = () => navigate(`/circles/${circle.slug ?? circle.id}`);

  return (
    <Card hover style={{ padding: 0, overflow: "hidden" }}>
      <button onClick={open} style={{ display: "block", width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
        <Photo
          src={circle.imageUrl ?? undefined}
          alt={circle.name}
          ph="repeating-linear-gradient(135deg,#DDE8DA 0 14px,#E6EEE3 14px 28px)"
          icon={<RepeatIcon size={22} />}
          iconColor={colors.green}
          style={{ height: 160 }}
          contentStyle={{ padding: 10, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}
        >
          {state ? (
            <span
              style={{
                background: state === "active-now" ? "rgba(232,163,58,.92)" : "rgba(255,255,255,.92)",
                color: state === "active-now" ? "#4A3400" : colors.text,
                borderRadius: 999, padding: "4px 11px", fontSize: 11.5, fontWeight: 800, letterSpacing: ".03em", textTransform: "uppercase",
              }}
            >
              {state === "active-now" ? "Active now" : "New"}
            </span>
          ) : <span />}
          {urgent && (
            <span style={{ background: "rgba(232,163,58,.92)", color: "#4A3400", borderRadius: 999, padding: "4px 11px", fontSize: 11.5, fontWeight: 800 }}>
              {spotsLabel(circle.nextPlan!.spotsLeft)}
            </span>
          )}
        </Photo>

        <div style={{ padding: "16px 16px 0" }}>
          <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16.5, color: colors.text, marginBottom: 2 }}>{circle.name}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: colors.mutedLight, fontSize: 13.5, marginBottom: 12 }}>
            {[circle.activityLabel, circle.area || circle.county].filter(Boolean).join(" · ") || "General"}
            {circle.hostVerified && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: 999, padding: "2px 7px" }}>
                <AwardIcon size={10} /> Verified
              </span>
            )}
          </div>

          <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 10 }}>
            {circle.nextPlan ? (
              <>
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: colors.mutedLight, marginBottom: 3 }}>Next</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 700, color: colors.text }}>
                  <CalendarIcon size={13} /> {dateLabel(circle.nextPlan.date)} · {circle.nextPlan.time}
                </div>
                <div style={{ fontSize: 13, color: circle.nextPlan.spotsLeft <= 3 ? colors.orangeDark : colors.muted, fontWeight: circle.nextPlan.spotsLeft <= 3 ? 700 : 400, marginTop: 3 }}>
                  {circle.nextPlan.joined} going · {spotsLabel(circle.nextPlan.spotsLeft)}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13.5, color: colors.faint }}>No upcoming plans yet</div>
            )}
          </div>
        </div>
      </button>

      <div style={{ padding: "12px 16px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: colors.mutedLight }}>
          <UsersIcon size={12} /> {circle.members} member{circle.members === 1 ? "" : "s"}
        </span>
        {joined ? (
          <Button variant="ghost" style={{ padding: "8px 16px", fontSize: 13 }} onClick={onLeave} disabled={busy}>You're in</Button>
        ) : (
          <Button style={{ padding: "8px 16px", fontSize: 13 }} onClick={onJoin} disabled={busy}>Join Circle</Button>
        )}
      </div>
    </Card>
  );
}

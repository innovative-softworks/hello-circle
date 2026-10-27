import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AwardIcon, CalendarIcon, PinIcon, RepeatIcon, UsersIcon } from "./icons";
import { Button, ConfirmDialog } from "./ui";
import { CardAction, CardArrow, ListingCard } from "./ListingCard";
import { SaveButton, useSavedState } from "./SaveButton";
import { dateLabel } from "../euro";
import { formatCircleAvailability } from "../formatters";
import { getCircleCoverUrl } from "../media";
import { colors, placeholderStripes } from "../theme";
import type { Circle } from "../types";

const DAY_MS = 86400000;

// Circle discovery card — the shared ListingCard shape (design-system
// consistency pass), matching the Circles page cards. A Circle's meetup is
// shown only when it is the Circle's own (nextPlan.source === "circle");
// "nearby" plans are other activities sharing the label. Join/leave keep
// the same confirmations as before.
export function CircleDiscoveryCard({ circle, joined, onJoin, onLeave, busy }: { circle: Circle; joined: boolean; onJoin: () => void; onLeave: () => void; busy: boolean }) {
  const navigate = useNavigate();
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [joinConfirmOpen, setJoinConfirmOpen] = useState(false);
  const [fav, toggleFav] = useSavedState("circle", circle.id);
  const href = `/circles/${circle.slug ?? circle.id}`;
  const plan = circle.nextPlan && circle.nextPlan.source === "circle" ? circle.nextPlan : null;
  const isNew = (Date.now() - new Date(circle.createdAt).getTime()) / DAY_MS <= 21;
  const activeNow = !!plan && (new Date(`${plan.date}T00:00:00`).getTime() - Date.now()) / DAY_MS <= 7;
  const where = [circle.area, circle.county].filter((v, i, a) => v && a.indexOf(v) === i).join(", ");
  const mode = circle.joinMode === "approval" ? "Approval needed" : circle.joinMode === "invite" ? "Invite only" : "Open to join";

  return (
    <>
      <ListingCard
        href={href}
        title={circle.name}
        image={getCircleCoverUrl(circle)}
        ph={placeholderStripes.green}
        icon={<RepeatIcon size={22} />}
        iconColor={colors.orange}
        tag={circle.activityLabel || "Circle"}
        status={activeNow ? { label: "Active this week" } : isNew ? { label: "New", tone: "calm" } : null}
        save={<SaveButton saved={fav} onToggle={toggleFav} />}
        details={[
          where ? { icon: <PinIcon size={13} />, text: where } : null,
          plan ? { icon: <CalendarIcon size={13} />, text: `Next meetup ${dateLabel(plan.date)} · ${plan.time} · ${formatCircleAvailability(plan.spotsLeft)}`, tone: plan.spotsLeft <= 3 ? "hot" : "default" } : null,
          circle.hostVerified ? { icon: <AwardIcon size={13} />, text: "Verified host" } : null,
        ]}
        facts={
          <>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <UsersIcon size={13} /> {circle.members} member{circle.members === 1 ? "" : "s"}
            </span>
            <span style={{ fontWeight: 600, color: colors.mutedLight }}>{joined ? "You're a member" : mode}</span>
          </>
        }
        action={
          joined ? (
            <CardAction look="neutral" onClick={() => setLeaveConfirmOpen(true)} disabled={busy} ariaLabel={`You're in ${circle.name} — leave?`}>
              You're in
            </CardAction>
          ) : circle.joinMode === "invite" ? (
            <CardArrow label={`View Circle: ${circle.name}`} onClick={() => navigate(href)} />
          ) : (
            <CardAction look="outline" arrow busy={busy} busyLabel="Joining…" onClick={() => setJoinConfirmOpen(true)} ariaLabel={`${circle.joinMode === "approval" ? "Request to join" : "Join"} ${circle.name}`}>
              {circle.joinMode === "approval" ? "Request to join" : "Join"}
            </CardAction>
          )
        }
      />
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
      <ConfirmDialog
        open={joinConfirmOpen}
        title={circle.joinMode === "approval" ? `Request to join ${circle.name}?` : `Join ${circle.name}?`}
        message={circle.joinMode === "approval" ? "The organiser will need to approve your request before you're a member." : `You'll be part of ${circle.name} and hear about every plan.`}
        confirmLabel={circle.joinMode === "approval" ? "Send request" : "Join Circle"}
        cancelLabel="Not now"
        tone="neutral"
        busy={busy}
        onConfirm={() => {
          onJoin();
          setJoinConfirmOpen(false);
        }}
        onCancel={() => setJoinConfirmOpen(false)}
      />
    </>
  );
}

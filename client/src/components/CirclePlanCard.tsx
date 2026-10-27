import { useNavigate } from "react-router-dom";
import { CalendarIcon, PinIcon, UsersIcon } from "./icons";
import { Button } from "./ui";
import { CardArrow, CardPrice, ListingCard } from "./ListingCard";
import { CardDate, itemCardLabel } from "./CardDate";
import { SaveButton, useSavedState } from "./SaveButton";
import { colors, placeholderStripes } from "../theme";
import type { CirclePlanPreview } from "../types";
import { formatCircleAvailability, formatDatePill } from "../formatters";

// Upcoming plan card (reference §11-13) — date/time badge over a photo,
// title, location, participation, availability, price. Plans don't carry
// their own gallery image in this app's data model (see CircleMoments'
// comment on why per-game photos all repeat the venue's own image), so the
// card uses the same tinted placeholder + icon convention as everywhere
// else a Game/Circle photo is optional. The heart re-uses the existing
// generic "game" favourite kind — a Circle plan's `id` is a real game id
// (see CircleDetail.tsx's handleJoinPlan), so this isn't new data, just an
// existing mechanism applied to a card that didn't expose it before.

export function CirclePlanCard({ plan }: { plan: CirclePlanPreview }) {
  const navigate = useNavigate();
  const [saved, toggleSaved] = useSavedState("game", plan.id);
  const href = `/games/${plan.id}`;
  const full = plan.spotsLeft === 0;

  // Design-system consistency pass: the shared ListingCard shape.
  return (
    <ListingCard
      href={href}
      title={plan.activityLabel}
      image={plan.imageUrl || null}
      ph={placeholderStripes.green}
      icon={<CalendarIcon size={22} />}
      iconColor={colors.orange}
      tag={`${formatDatePill(plan.date)} · ${plan.time}`}
      kicker={false}
      dateOn={<CardDate date={plan.date} time={plan.time} label={itemCardLabel({ date: plan.date, time: plan.time, spotsLeft: plan.spotsLeft, joined: plan.joined, capacity: plan.capacity, firstTimeFriendly: !!plan.soloFriendly && !plan.experienceRequired })} href={href} onGo={navigate} />}
      status={
        full
          ? { label: "Full", tone: "calm" }
          : plan.spotsLeft <= 3
            ? { label: formatCircleAvailability(plan.spotsLeft) }
            : // Circle Experience 2.0 — only from what the host set: people come on
              // their own and no experience is asked for.
              plan.soloFriendly && !plan.experienceRequired
              ? { label: "First-time friendly", tone: "new" }
              : null
      }
      save={<SaveButton saved={saved} onToggle={toggleSaved} />}
      details={[{ icon: <PinIcon size={13} />, text: plan.centreName ?? (plan.locationText || "Location TBC") }]}
      facts={
        <>
          <CardPrice cents={plan.priceCents} unit="per person" />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <UsersIcon size={13} /> {plan.joined} going
          </span>
        </>
      }
      action={
        <CardArrow label={`${full ? "View plan" : "See plan"}: ${plan.activityLabel}`} onClick={() => navigate(href)} />
      }
    />
  );
}

import { useNavigate } from "react-router-dom";
import type { CirclePlanIdea } from "../../types";
import { CompactRow, CompactRows } from "../CompactRow";
import { irelandToday } from "../../irelandDate";
import { LISTING_KIND_LABEL } from "./CirclePlanListing";

// Circles 3.0 — under "Next up" on Circle Home: the next few dated plans
// about real listings (an adventure, a programme session…), so members see
// them without opening Plans. A plan isn't a booking: each row says whether
// you're booked or still need to, and opens the plan in the Circle.

export function CirclePlannedTogether({ plans, circleSlugOrId }: { plans: CirclePlanIdea[]; circleSlugOrId: string }) {
  const navigate = useNavigate();
  const today = irelandToday();
  const rows = plans
    .filter((p) => (p.status === "idea" || p.status === "confirmed") && p.listing && p.listing.date && p.listing.date >= today && (p.listing.availability === "available" || p.listing.availability === "full"))
    .sort((a, b) => `${a.listing!.date} ${a.listing!.time ?? ""}`.localeCompare(`${b.listing!.date} ${b.listing!.time ?? ""}`))
    .slice(0, 3);
  if (rows.length === 0) return null;
  return (
    <div className="ch-planned" aria-label="Planned together">
      <p className="ch-planned-title">Planned together</p>
      <CompactRows>
        {rows.map((p) => {
          const l = p.listing!;
          const state = l.myState === "booked" ? "You're booked" : p.interestedByMe ? "You're in · not booked" : `${p.interestCount ?? 0} in so far`;
          const href = `/circles/${circleSlugOrId}?tab=activities#plan-${p.id}`;
          return (
            <CompactRow
              key={p.id}
              href={href}
              onOpen={() => navigate(href)}
              image={l.imageUrl}
              date={l.date!}
              time={l.time}
              label={{ rest: LISTING_KIND_LABEL[l.kind] ?? "Plan", tone: "line" }}
              title={p.title}
              meta={[l.where, l.availability === "full" ? "Full" : null, state].filter(Boolean).join(" · ")}
            />
          );
        })}
      </CompactRows>
    </div>
  );
}

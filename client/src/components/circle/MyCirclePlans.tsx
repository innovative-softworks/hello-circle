import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchMyCirclePlans } from "../../api";
import { dateLabel } from "../../euro";
import type { MyCirclePlan } from "../../types";
import { LISTING_KIND_LABEL, listingCta } from "./CirclePlanListing";
import "./circleExperience.css";

// Circles 3.0 — My Life "Plans you're in": Circle plans you said "I'm in"
// to, one row per thing (planned in two Circles = one row naming both).
// Each says plainly whether you're booked, still need to book, or it's just
// an idea, so interest is never read as a booking.

function stateOf(p: MyCirclePlan): { label: string; tone: "ok" | "todo" | "idea" | "gone" } {
  const l = p.listing;
  if (l && (l.availability === "cancelled" || l.availability === "unavailable" || l.availability === "past")) return { label: l.availability === "cancelled" ? "Cancelled by the provider" : "No longer available", tone: "gone" };
  if (l?.myState === "booked") return { label: "Booked", tone: "ok" };
  if (l?.myState === "waitlisted") return { label: "Waitlisted", tone: "todo" };
  if (l && l.availability === "no_dates") return { label: "Interested · no dates yet", tone: "idea" };
  if (l && l.kind !== "venue" && l.kind !== "club") return { label: l.availability === "full" ? "Interested · full" : "Interested · booking required", tone: "todo" };
  return { label: p.status === "confirmed" ? "Interested · confirmed by the Circle" : "Interested", tone: "idea" };
}

export function MyCirclePlans() {
  const [plans, setPlans] = useState<MyCirclePlan[] | null>(null);
  useEffect(() => {
    fetchMyCirclePlans().then(setPlans).catch(() => setPlans([]));
  }, []);
  if (!plans || plans.length === 0) return null;
  return (
    <section className="mlx-section" aria-labelledby="mlx-circle-plans">
      <div className="mlx-section-head">
        <h2 className="mlx-label" id="mlx-circle-plans">Plans you're in</h2>
      </div>
      <ul className="mcp">
        {plans.slice(0, 8).map((p) => {
          const s = stateOf(p);
          const date = p.listing?.date ?? p.proposedDate;
          const time = p.listing?.time ?? p.proposedTime;
          const first = p.circles[0];
          return (
            <li key={p.key} className="mcp-row">
              <div className="mcp-when">{date ? <strong>{dateLabel(date)}</strong> : <strong>No date yet</strong>}{time && <span>{time}</span>}</div>
              <div className="mcp-main">
                <p className="mcp-title">
                  {p.listing ? <span className="mcp-kind">{LISTING_KIND_LABEL[p.listing.kind] ?? "Plan"}</span> : <span className="mcp-kind">Plan</span>}
                  {p.title}
                </p>
                <p className="mcp-meta">
                  With {p.circles.map((c) => c.name).join(" and ")}
                  {p.listing?.where ? ` · ${p.listing.where}` : ""}
                </p>
                <span className={`mcp-state mcp-state--${s.tone}`}>{s.label}</span>
              </div>
              <div className="mcp-actions">
                {p.listing?.href && s.tone !== "gone" && (
                  <Link className="mlx-link" to={p.listing.href}>
                    {listingCta(p.listing)}
                  </Link>
                )}
                <Link className="mlx-link" to={`/circles/${first.slug ?? first.id}?tab=activities#plan-${first.planId}`}>
                  Open plan
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

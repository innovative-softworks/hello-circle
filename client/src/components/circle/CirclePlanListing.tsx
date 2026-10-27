import { Link } from "react-router-dom";
import { dateLabel } from "../../euro";
import { formatPrice } from "../../formatters";
import type { CirclePlanListing } from "../../types";

// Circles 3.0 — the listing a Circle plan is about, inside the plan row.
// A plan never holds a place: the button always goes to the listing's own
// page, where people book, join or enrol exactly as they would without the
// Circle. Availability and "you've booked" are read live by the server.

export const LISTING_KIND_LABEL: Record<string, string> = {
  activity: "Activity",
  adventure: "Adventure",
  experience: "Experience",
  volunteer: "Volunteering",
  programme: "Programme",
  venue: "Place",
  club: "Club",
};

/** The action named for what the listing is (Circles 3.0 §6D). */
export function listingCta(l: CirclePlanListing): string {
  if (l.myState === "booked") return l.kind === "activity" ? "View your place" : "View your booking";
  if (l.myState === "waitlisted") return "View waitlist";
  if (l.availability === "full") return l.kind === "activity" ? "Join the waitlist" : "See other dates";
  if (l.availability === "no_dates") return l.kind === "programme" ? "View programme" : "View dates";
  switch (l.kind) {
    case "activity":
      return "Join activity";
    case "adventure":
      return "Book adventure";
    case "experience":
      return "Book experience";
    case "volunteer":
      return "Volunteer";
    case "programme":
      return "Enrol in programme";
    default:
      return "View place";
  }
}

const AVAILABILITY: Record<CirclePlanListing["availability"], string | null> = {
  available: null,
  full: "Full",
  past: "Already happened",
  cancelled: "Cancelled by the provider",
  unavailable: "No longer available",
  no_dates: "No dates yet",
};

/** `inLink` (Circles 3.1): shown under a linked listing, not a plan, so the
 * "being in this plan" line doesn't apply (the section says nothing is booked). */
export function CirclePlanListingBlock({ listing: l, interested, inLink }: { listing: CirclePlanListing; interested?: boolean; inLink?: boolean }) {
  const label = LISTING_KIND_LABEL[l.kind] ?? "Listing";
  const gone = l.availability === "cancelled" || l.availability === "unavailable" || l.availability === "past";
  const when = l.date ? `${dateLabel(l.date)}${l.time ? ` · ${l.time}` : ""}` : null;
  const state = l.myState === "booked" ? "You've booked" : l.myState === "waitlisted" ? "You're on the waitlist" : interested ? "You're interested (not booked)" : null;
  return (
    <div className={`cpl${gone ? " cpl--gone" : ""}`}>
      <div className="cpl-row">
        <span className="cpl-kind">{label}</span>
        {AVAILABILITY[l.availability] && <span className={`cpl-chip${gone ? " cpl-chip--gone" : l.availability === "no_dates" ? " cpl-chip--keen" : " cpl-chip--full"}`}>{AVAILABILITY[l.availability]}</span>}
        {state && <span className={`cpl-chip ${l.myState ? "cpl-chip--booked" : "cpl-chip--keen"}`}>{state}</span>}
      </div>
      {!gone && (
        <p className="cpl-facts">
          {[when, l.where, l.priceCents ? `${formatPrice(l.priceCents)}${l.kind === "programme" ? " for the programme" : " per person"}` : l.kind === "venue" || l.kind === "club" ? null : "Free", l.spotsLeft !== null && l.availability === "available" && l.spotsLeft <= 5 ? `${l.spotsLeft} left` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {l.bookingNote && !gone && <p className="cpl-note">{l.bookingNote}</p>}
      {gone ? (
        <p className="cpl-note">{l.availability === "unavailable" ? "This listing can't be booked any more. Nothing was booked through this plan." : "Nothing can be booked for this any more."}</p>
      ) : l.href ? (
        <Link className="cpl-cta" to={l.href}>
          {listingCta(l)} →
        </Link>
      ) : (
        <p className="cpl-note">Venue pages are coming soon. Meet here as planned.</p>
      )}
      {!inLink && !gone && !l.myState && l.kind !== "venue" && l.kind !== "club" && <p className="cpl-hint">Being in this plan doesn't book you a place.</p>}
    </div>
  );
}
